// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Offset UTC para Chile (CLT GMT-4).
// ¡¡¡ADVERTENCIA MUY IMPORTANTE!!! Esto NO maneja el cambio de horario de verano (CLST GMT-3).
// Para una solución de producción robusta, se NECESITA una librería de timezones o una API.
// En Mayo, Chile está en GMT-4.
const CHILE_UTC_OFFSET_HOURS = -4; // Chile está UTC-4 horas

function convertChileTimeToUtc(dateObjectUtcDay, chileHour, chileMinute) {
  // dateObjectUtcDay es un Date object al inicio de un día UTC (ej. 2025-05-15T00:00:00.000Z)
  // chileHour y chileMinute son la hora local de Chile que queremos convertir (ej. 10, 0 para 10:00 AM Chile)
  
  // Calculamos la hora UTC correspondiente
  let utcHour = chileHour - CHILE_UTC_OFFSET_HOURS; // Ej: 10 - (-4) = 14 UTC

  const newUtcDate = new Date(dateObjectUtcDay); // Clonamos para no modificar el original
  newUtcDate.setUTCHours(utcHour, chileMinute, 0, 0);
  return newUtcDate;
}

function getDayIdentifier(dateObj, timeZone) {
    // Devuelve un string YYYY-MM-DD para una fecha en una timezone específica
    return new Intl.DateTimeFormat('en-CA', { // en-CA da YYYY-MM-DD
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: timeZone
    }).format(dateObj);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Falta el mensaje del usuario' });

  try {
    console.log('📨 Mensaje recibido:', message);

    const lowerMessage = message.toLowerCase();
    const isCalendarQuery = lowerMessage.includes('hora') || lowerMessage.includes('turno') || lowerMessage.includes('disponibilidad') || lowerMessage.includes('agenda') || lowerMessage.includes('cuando');

    if (isCalendarQuery) {
      console.log('⏳ Detectada consulta de calendario');
      const calendar = await getCalendarClient();
      const serverNowUtc = new Date(); // Hora actual del servidor (UTC)

      let targetDateObj = null; // El objeto Date del día específico que busca el usuario (en Chile TZ)
      let targetHourChile = null; // La hora específica en Chile (0-23)
      let targetMinuteChile = 0;  // El minuto específico en Chile (0 o 30)
      let timeOfDay = null;     // "morning" o "afternoon"

      // --- Extracción de Día ---
      const dayKeywords = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6 };
      
      // 'todayInChileLocal' es el objeto Date que representa el inicio del día de HOY en Chile
      const todayInChileLocal = new Date(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', year: 'numeric', month: 'numeric', day: 'numeric' }).format(serverNowUtc));
      todayInChileLocal.setHours(0,0,0,0);


      if (lowerMessage.includes('hoy')) {
        targetDateObj = new Date(todayInChileLocal);
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDateObj = new Date(todayInChileLocal);
        targetDateObj.setDate(targetDateObj.getDate() + 1);
      } else {
        for (const [keyword, dayIndex] of Object.entries(dayKeywords)) {
          if (lowerMessage.includes(keyword)) {
            let tempDate = new Date(todayInChileLocal);
            let currentDayIndex = tempDate.getDay();
            let daysToAdd = dayIndex - currentDayIndex;
            if (daysToAdd < 0 || (daysToAdd === 0 && serverNowUtc.getHours() >= (19 - CHILE_UTC_OFFSET_HOURS))) { // Si es hoy y ya pasó el horario laboral
                daysToAdd += 7;
            }
            tempDate.setDate(tempDate.getDate() + daysToAdd);
            targetDateObj = tempDate;
            break;
          }
        }
      }
      if (targetDateObj) console.log(`🗓️ Día objetivo (Chile): ${targetDateObj.toLocaleDateString('es-CL')}`);


      // --- Extracción de Hora ---
      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30))?\s*(pm|am|h|hr|hrs)?/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        const minuteStr = timeMatch[3];
        targetMinuteChile = minuteStr ? parseInt(minuteStr, 10) : 0;

        const isPm = timeMatch[4] && timeMatch[4].toLowerCase() === 'pm';
        const isAm = timeMatch[4] && timeMatch[4].toLowerCase() === 'am';

        if (isPm && hour >= 1 && hour <= 11) hour += 12;
        if (isAm && hour === 12) hour = 0; // 12 AM es 0 horas
        
        // Heurística para horas sin am/pm (ej. "a las 3" -> 3 PM)
        if (!isPm && !isAm && hour >= 1 && hour <= 7) hour += 12; 

        targetHourChile = hour;
        console.log(`⏰ Hora objetivo (Chile): ${targetHourChile}:${targetMinuteChile.toString().padStart(2,'0')}`);
      }

      if (!targetHourChile) {
        if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) timeOfDay = 'morning';
        else if (lowerMessage.includes('tarde')) timeOfDay = 'afternoon';
        if(timeOfDay) console.log(`🕒 Franja horaria: ${timeOfDay}`);
      }

      // --- Obtener eventos del calendario (próximos 7 días UTC) ---
      const calendarQueryStartUtc = new Date(serverNowUtc);
      const calendarQueryEndUtc = new Date(serverNowUtc);
      calendarQueryEndUtc.setDate(calendarQueryEndUtc.getDate() + 7);

      const googleResponse = await calendar.events.list({
        calendarId: 'primary',
        timeMin: calendarQueryStartUtc.toISOString(),
        timeMax: calendarQueryEndUtc.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const busySlots = googleResponse.data.items
        .filter(e => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime)
        .map(e => ({
          start: new Date(e.start.dateTime).getTime(), // UTC timestamp
          end: new Date(e.end.dateTime).getTime()     // UTC timestamp
        }));

      // --- Generar y Filtrar Slots Disponibles ---
      const WORKING_HOURS_CHILE = [ // Horas locales de Chile
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];
      const availableSlotsOutput = [];

      for (let i = 0; i < 7; i++) { // Iterar sobre los próximos 7 días
        const currentDayUtc = new Date(serverNowUtc); // Día base para el cálculo del slot
        currentDayUtc.setUTCDate(serverNowUtc.getUTCDate() + i); // Avanzar día en UTC
        currentDayUtc.setUTCHours(0, 0, 0, 0); // Inicio del día UTC

        // Si el usuario especificó un día (targetDateObj está en hora Chile),
        // comparamos si el currentDayUtc (formateado a Chile) es ese día.
        if (targetDateObj) {
          if (getDayIdentifier(currentDayUtc, 'America/Santiago') !== getDayIdentifier(targetDateObj, 'America/Santiago')) {
            continue; // No es el día que el usuario pidió
          }
        }

        for (const timeChile of WORKING_HOURS_CHILE) {
          const [hChileStr, mChileStr] = timeChile.split(':');
          const hChile = parseInt(hChileStr, 10);
          const mChile = parseInt(mChileStr, 10);

          // Aplicar filtros de hora/franja si existen
          if (targetHourChile !== null) { // Usuario pidió hora específica
            if (hChile !== targetHourChile || mChile !== targetMinuteChile) continue;
          } else if (timeOfDay) { // Usuario pidió franja (mañana/tarde)
            if (timeOfDay === 'morning' && (hChile < 10 || hChile >= 14)) continue;
            if (timeOfDay === 'afternoon' && (hChile < 14 || hChile > 19 || (hChile === 19 && mChile > 30))) continue;
          }

          // Convertir la hora local de Chile del slot a UTC
          const slotStartUtc = convertChileTimeToUtc(currentDayUtc, hChile, mChile);
          
          if (isNaN(slotStartUtc.getTime())) {
            console.error("Slot inválido generado:", currentDayUtc, hChile, mChile);
            continue;
          }

          // Si el slot es pasado (comparado con ahora UTC), ignorar
          if (slotStartUtc < serverNowUtc) continue;

          const slotEndUtc = new Date(slotStartUtc);
          slotEndUtc.setUTCMinutes(slotEndUtc.getUTCMinutes() + 30);

          const isBusy = busySlots.some(busy => slotStartUtc.getTime() < busy.end && slotEndUtc.getTime() > busy.start);

          if (!isBusy) {
            availableSlotsOutput.push(
              new Intl.DateTimeFormat('es-CL', {
                weekday: 'long', day: 'numeric', month: 'long',
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago'
              }).format(slotStartUtc) // Formatear el slot UTC a la hora de Chile
            );
          }
        }
      }
      
      // --- Construir Respuesta ---
      let reply = '';
      const MAX_SUGGESTIONS = 5;

      if (targetHourChile !== null) { // Si se buscó una hora específica
        if (availableSlotsOutput.length > 0) {
          // Debería haber solo un slot en availableSlotsOutput debido al filtro
          reply = `¡Sí! El ${availableSlotsOutput[0]} está disponible. Te recomiendo contactar directamente para confirmar y reservar.`;
        } else {
          let specificTimeQuery = "";
          if(targetDateObj) specificTimeQuery += `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateObj)} `;
          specificTimeQuery += `a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
          reply = `Lo siento, ${specificTimeQuery} no se encuentra disponible. ¿Te gustaría buscar otro horario?`;
        }
      } else if (availableSlotsOutput.length > 0) {
        let intro = `📅 Estas son algunas horas disponibles`;
        if (targetDateObj) { // Si se especificó un día, usarlo en la intro
            intro += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateObj)}`;
        }
        if (timeOfDay === 'morning') intro += ' por la mañana';
        if (timeOfDay === 'afternoon') intro += ' por la tarde';
        intro += ':';

        reply = `${intro}\n- ${availableSlotsOutput.slice(0, MAX_SUGGESTIONS).join('\n- ')}`;
        if (availableSlotsOutput.length > MAX_SUGGESTIONS) {
          reply += `\n\n(Y ${availableSlotsOutput.length - MAX_SUGGESTIONS} más...)`;
        }
      } else {
        reply = 'No se encontraron horas disponibles para la fecha o rango especificado.';
        if (targetDateObj || timeOfDay || targetHourChile) reply += ' ¿Te gustaría probar con otra búsqueda?';
      }

      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } // Fin if (isCalendarQuery)

    // --- Si no es consulta de calendario, usar OpenAI ---
    console.log('💡 Consulta normal, usando OpenAI');
    const chatResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Eres Rigbot, un amable asistente virtual de una consulta quiropráctica en Copiapó. Responde siempre de forma amigable y cercana. Si el usuario solicita agendar, indícale que solo puedes consultar disponibilidad, no reservar. Cuando consultes disponibilidad y encuentres un horario específico, informa que está disponible y sugiere contactar para reservar. Si no encuentras, informa que no está disponible y pregunta si desea buscar otro horario.' },
        { role: 'user', content: message }
      ]
    });
    const gptReply = chatResponse.choices[0].message.content.trim();
    return res.status(200).json({ response: gptReply });

  } catch (error) {
    console.error('❌ Error en Rigbot:', error);
    console.error(error.stack);
    return res.status(500).json({ error: 'Ocurrió un error en Rigbot. ' + error.message });
  }
}
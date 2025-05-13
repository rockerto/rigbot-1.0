// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Función auxiliar para obtener el próximo día de la semana (0=Domingo, ..., 4=Jueves)
// partiendo desde 'startDate' (que ya está en la zona horaria correcta, ej. Chile)
function getNextDayOfWeek(targetDayIndex, startDate, timeZone) {
  const currentDayIndex = startDate.getDay(); // 0 para Domingo, 1 para Lunes...
  let daysToAdd = targetDayIndex - currentDayIndex;
  if (daysToAdd < 0) {
    daysToAdd += 7; // Si ya pasó esta semana, la próxima
  } else if (daysToAdd === 0 && new Date().getHours() >= 20 && startDate.getDate() === new Date().getDate()){
    // Si es hoy y ya es tarde (ej. después de las 8 PM), buscar para la próxima semana
    daysToAdd +=7;
  }
  
  const nextDate = new Date(startDate);
  nextDate.setDate(startDate.getDate() + daysToAdd);
  return nextDate;
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

      // --- MANEJO DE FECHA Y HORA CON NATIVE DATE Y CONSIDERANDO ZONA HORARIA PARA SALIDA ---
      // Asumimos que el servidor Vercel corre en UTC.
      // 'nowServerTime' es la hora actual del servidor (UTC)
      const nowServerTime = new Date(); 
      
      // Para determinar 'hoy' en Chile, necesitamos la hora actual de Chile
      // Usaremos Intl para obtener el offset, aunque es un poco hacky para cálculos, sirve para 'hoy'
      // Una forma más robusta sería tener el offset o usar una librería mínima si fuera necesario.
      // Por ahora, asumimos que las operaciones con 'nowServerTime' y sumando días son en UTC
      // y solo al final formateamos a 'America/Santiago'.

      let targetDate = null; // La fecha específica que el usuario podría querer
      let targetHour = null; // La hora específica (ej. 15 para 3 PM)
      let timeOfDay = null; // "mañana" (morning) o "tarde" (afternoon)

      // --- Extracción básica de día y hora ---
      const dayKeywords = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6 };
      
      // Crear 'todayInChile' para referencia de qué día es "hoy" o "mañana" en Chile
      // Esto se hace formateando la hora del servidor a la zona de Chile y parseando de nuevo.
      // No es ideal para cálculos complejos de DST, pero para 'hoy'/'mañana' funciona.
      const formatterForToday = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Santiago' });
      const parts = formatterForToday.formatToParts(nowServerTime).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
      const todayInChile = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`);


      if (lowerMessage.includes('hoy')) {
        targetDate = new Date(todayInChile); // Usar el 'hoy' de Chile
        targetDate.setHours(0,0,0,0); // Inicio del día
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDate = new Date(todayInChile);
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(0,0,0,0);
      } else {
        for (const [keyword, dayIndex] of Object.entries(dayKeywords)) {
          if (lowerMessage.includes(keyword)) {
            targetDate = getNextDayOfWeek(dayIndex, todayInChile, 'America/Santiago');
            targetDate.setHours(0,0,0,0);
            break;
          }
        }
      }

      if (targetDate) {
        console.log(`🗓️ Día objetivo detectado (en Chile): ${targetDate.toLocaleDateString('es-CL')}`);
      }

      const timeMatch = lowerMessage.match(/(\d{1,2})(:\d{2})?\s*(pm|am|h|hrs)?/);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        const isPm = timeMatch[3] === 'pm';
        if (isPm && hour < 12) hour += 12;
        if (!isPm && timeMatch[3] !== 'am' && hour < 9) { // heurística: si dice 2, 3, 4 sin am/pm, es tarde
            if (hour >= 1 && hour <= 7) hour += 12; // 1 -> 13, 7 -> 19
        }
        targetHour = hour;
        console.log(`⏰ Hora objetivo detectada: ${targetHour}:00`);
      }


      if (!targetHour) { // Solo si no se especificó hora exacta
        if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) timeOfDay = 'morning';
        else if (lowerMessage.includes('tarde')) timeOfDay = 'afternoon';
      }

      // Obtener eventos del calendario
      const calendarStartTime = new Date(nowServerTime); // Desde ahora UTC
      const calendarEndTime = new Date(nowServerTime);
      calendarEndTime.setDate(calendarEndTime.getDate() + 7); // Para los próximos 7 días

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: calendarStartTime.toISOString(),
        timeMax: calendarEndTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const busySlots = response.data.items.map(e => {
        if (e.start?.dateTime && e.end?.dateTime) {
          return {
            start: new Date(e.start.dateTime).getTime(), // UTC timestamp
            end: new Date(e.end.dateTime).getTime()   // UTC timestamp
          };
        } // Omitimos eventos de día completo para simplificar la lógica de slots
      }).filter(Boolean);

      const WORKING_HOURS = [
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];

      const availableSlotsOutput = [];
      // Iteramos sobre los próximos 7 días basados en el tiempo del servidor (UTC)
      for (let i = 0; i < 7; i++) { // 7 días desde hoy (servidor)
        const currentProcessingDayUtc = new Date(nowServerTime);
        currentProcessingDayUtc.setDate(nowServerTime.getDate() + i);
        currentProcessingDayUtc.setHours(0, 0, 0, 0); // Inicio del día UTC

        // Si el usuario especificó un targetDate (que está en timezone Chile),
        // comparamos si currentProcessingDayUtc (convertido a Chile) es ese día.
        if (targetDate) {
            // Convertimos el currentProcessingDayUtc a la fecha de Chile para comparar
            const currentProcessingDayInChileFormatted = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Santiago' }).format(currentProcessingDayUtc);
            const targetDateFormatted = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Santiago' }).format(targetDate);
            if (currentProcessingDayInChileFormatted !== targetDateFormatted) {
              continue; // No es el día que el usuario pidió
            }
        }
        
        WORKING_HOURS.forEach(time => {
          const [slotHourStr, slotMinuteStr] = time.split(':');
          const slotH = parseInt(slotHourStr, 10);
          const slotM = parseInt(slotMinuteStr, 10);

          // Filtro por hora específica
          if (targetHour !== null && slotH !== targetHour) return;
          
          // Filtro por franja horaria (mañana/tarde) si no hay hora específica
          if (targetHour === null && timeOfDay) {
            if (timeOfDay === 'morning' && (slotH < 10 || slotH >= 14)) return; // Mañana: 10:00-13:30
            if (timeOfDay === 'afternoon' && (slotH < 14 || slotH > 19)) return; // Tarde: 14:00-19:30 (último slot 19:30)
          }

          const slotStartUtc = new Date(currentProcessingDayUtc);
          slotStartUtc.setUTCHours(slotH, slotM, 0, 0); // CREAR EL SLOT EN UTC

          // Si el slot es en el pasado (comparado con la hora actual del servidor), lo ignoramos
          if (slotStartUtc < nowServerTime) return;

          const slotEndUtc = new Date(slotStartUtc);
          slotEndUtc.setUTCMinutes(slotStartUtc.getUTCMinutes() + 30);

          const isBusy = busySlots.some(busy => slotStartUtc.getTime() < busy.end && slotEndUtc.getTime() > busy.start);

          if (!isBusy) {
            availableSlotsOutput.push(new Intl.DateTimeFormat('es-CL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Santiago' // MUY IMPORTANTE para la salida correcta
            }).format(slotStartUtc)); // Formatear el slot UTC a la hora de Chile
          }
        });
      }
      
      let reply = '';
      const MAX_SUGGESTIONS = 5;

      if (targetHour !== null) { // Si se buscó una hora específica
        if (availableSlotsOutput.length > 0) {
          // Debería haber solo un slot si se encontró y coincidió la hora
          reply = `¡Sí! El ${availableSlotsOutput[0]} está disponible.`;
        } else {
          let specificTimeQuery = "";
          if(targetDate) specificTimeQuery += `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDate)} `;
          specificTimeQuery += `a las ${targetHour}:00`;
          reply = `Lo siento, ${specificTimeQuery} no se encuentra disponible. ¿Te gustaría buscar otro horario?`;
        }
      } else if (availableSlotsOutput.length > 0) {
        let intro = `📅 Estas son algunas horas disponibles`;
        if (targetDate) {
            intro += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDate)}`;
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
        if (targetDate || timeOfDay) reply += ' ¿Te gustaría probar con otra búsqueda?';
      }

      return res.status(200).json({ response: reply });
    }

    // Si no es consulta de calendario, usar OpenAI
    console.log('💡 Consulta normal, usando OpenAI');
    const chatResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'Eres Rigbot, un amable asistente virtual de una consulta quiropráctica en Copiapó. Responde siempre de forma amigable y cercana. Si el usuario solicita agendar, indícale que solo puedes consultar disponibilidad, no reservar.' },
        { role: 'user', content: message }
      ]
    });
    const gptReply = chatResponse.choices[0].message.content.trim();
    return res.status(200).json({ response: gptReply });

  } catch (error) {
    console.error('❌ Error en Rigbot:', error);
    console.error(error.stack); // Loguear el stacktrace completo
    return res.status(500).json({ error: 'Ocurrió un error en Rigbot. ' + error.message });
  }
}
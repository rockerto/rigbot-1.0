// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const CHILE_UTC_OFFSET_HOURS = -4; 

function convertChileTimeToUtc(dateObjectUtcDay, chileHour, chileMinute) {
  let utcHour = chileHour - CHILE_UTC_OFFSET_HOURS;
  const newUtcDate = new Date(dateObjectUtcDay);
  newUtcDate.setUTCHours(utcHour, chileMinute, 0, 0);
  return newUtcDate;
}

function getDayIdentifier(dateObj, timeZone) {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
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
      const serverNowUtc = new Date(); 

      let targetDateForIntro = null; 
      let targetHourChile = null; 
      let targetMinuteChile = 0;  
      let timeOfDay = null;     

      const todayInChileLocalStartOfDay = new Date(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', year: 'numeric', month: 'numeric', day: 'numeric' }).format(serverNowUtc));
      todayInChileLocalStartOfDay.setHours(0,0,0,0);

      if (lowerMessage.includes('hoy')) {
        targetDateForIntro = new Date(todayInChileLocalStartOfDay);
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDateForIntro = new Date(todayInChileLocalStartOfDay);
        targetDateForIntro.setDate(targetDateForIntro.getDate() + 1);
      } else {
        const dayKeywords = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6 };
        for (const [keyword, dayIndex] of Object.entries(dayKeywords)) {
          if (lowerMessage.includes(keyword)) {
            let tempDate = new Date(todayInChileLocalStartOfDay);
            let currentDayIndex = tempDate.getDay();
            let daysToAdd = dayIndex - currentDayIndex;
            if (daysToAdd < 0 || (daysToAdd === 0 && serverNowUtc.getUTCHours() >= (19 - CHILE_UTC_OFFSET_HOURS))) {
                daysToAdd += 7;
            }
            tempDate.setDate(tempDate.getDate() + daysToAdd);
            targetDateForIntro = tempDate;
            break;
          }
        }
      }
      if(targetDateForIntro) console.log(`🗓️ Día objetivo para intro (Chile): ${targetDateForIntro.toLocaleDateString('es-CL')}`);
      
      const targetDateIdentifierChile = targetDateForIntro ? getDayIdentifier(targetDateForIntro, 'America/Santiago') : null;
      if(targetDateIdentifierChile) console.log(`🗓️ Día objetivo ID (Chile): ${targetDateIdentifierChile}`);

      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30))?\s*(pm|am|h|hr|hrs)?/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        targetMinuteChile = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const isPm = timeMatch[4] && timeMatch[4].toLowerCase() === 'pm';
        const isAm = timeMatch[4] && timeMatch[4].toLowerCase() === 'am';
        if (isPm && hour >= 1 && hour <= 11) hour += 12;
        if (isAm && hour === 12) hour = 0;
        if (!isPm && !isAm && hour >= 1 && hour <= 7 && hour !== 0) hour += 12;
        targetHourChile = hour;
        console.log(`⏰ Hora objetivo (Chile): ${targetHourChile}:${targetMinuteChile.toString().padStart(2,'0')}`);
      }

      if (!targetHourChile) {
        if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) timeOfDay = 'morning';
        else if (lowerMessage.includes('tarde')) timeOfDay = 'afternoon';
        if(timeOfDay) console.log(`🕒 Franja horaria: ${timeOfDay}`);
      }
      
      const WORKING_HOURS_CHILE_NUMERIC = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5];
      if (targetHourChile !== null) {
        const requestedTimeNumeric = targetHourChile + (targetMinuteChile / 60);
        if (!WORKING_HOURS_CHILE_NUMERIC.includes(requestedTimeNumeric) || requestedTimeNumeric < 10 || requestedTimeNumeric > 19.5) {
            let reply = `Lo siento, la hora ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')} está fuera de nuestro horario de atención (10:00 a 19:30).`;
            if (targetDateForIntro) {
                reply = `Lo siento, ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForIntro)} a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')} está fuera de nuestro horario de atención (10:00 a 19:30).`;
            }
            return res.status(200).json({ response: reply });
        }
      }

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
        .filter(e => e.status !== 'cancelled')
        .map(e => {
          if (e.start?.dateTime && e.end?.dateTime) {
            return { start: new Date(e.start.dateTime).getTime(), end: new Date(e.end.dateTime).getTime() };
          } else if (e.start?.date && e.end?.date) {
            const startDateAllDayUtc = new Date(e.start.date);
            const endDateAllDayUtc = new Date(e.end.date);
            return { start: startDateAllDayUtc.getTime(), end: endDateAllDayUtc.getTime() };
          }
          return null;
        }).filter(Boolean);

      const WORKING_HOURS_CHILE_STR = [
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];
      const availableSlotsOutput = [];

      for (let i = 0; i < 7; i++) {
        const currentDayUtcStart = new Date(serverNowUtc);
        currentDayUtcStart.setUTCDate(serverNowUtc.getUTCDate() + i);
        currentDayUtcStart.setUTCHours(0, 0, 0, 0);

        if (targetDateIdentifierChile) {
          if (getDayIdentifier(currentDayUtcStart, 'America/Santiago') !== targetDateIdentifierChile) {
            continue;
          }
        }
        
        for (const timeChileStr of WORKING_HOURS_CHILE_STR) {
          const [hChile, mChile] = timeChileStr.split(':').map(Number);

          if (targetHourChile !== null) {
            if (hChile !== targetHourChile || mChile !== targetMinuteChile) continue;
          } else if (timeOfDay) {
            if (timeOfDay === 'morning' && (hChile < 10 || hChile >= 14)) continue;
            if (timeOfDay === 'afternoon' && (hChile < 14 || hChile > 19 || (hChile === 19 && mChile > 30))) continue;
          }

          const slotStartUtc = convertChileTimeToUtc(currentDayUtcStart, hChile, mChile);
          if (isNaN(slotStartUtc.getTime())) {
            console.error("Slot UTC inválido generado:", currentDayUtcStart, hChile, mChile);
            continue;
          }
          if (slotStartUtc < serverNowUtc) continue;

          const slotEndUtc = new Date(slotStartUtc);
          slotEndUtc.setUTCMinutes(slotEndUtc.getUTCMinutes() + 30);

          const isBusy = busySlots.some(busy => slotStartUtc.getTime() < busy.end && slotEndUtc.getTime() > busy.start);

          if (!isBusy) {
            availableSlotsOutput.push(
              new Intl.DateTimeFormat('es-CL', {
                weekday: 'long', day: 'numeric', month: 'long',
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago'
              }).format(slotStartUtc)
            );
          }
        }
      }
      
      let reply = '';
      const MAX_SUGGESTIONS = 5;

      if (targetHourChile !== null) {
        if (availableSlotsOutput.length > 0) {
          reply = `¡Sí! El ${availableSlotsOutput[0]} está disponible. Te recomiendo contactar directamente para confirmar y reservar.`;
        } else {
          let specificTimeQuery = "";
          if(targetDateForIntro) specificTimeQuery += `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForIntro)} `;
          specificTimeQuery += `a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
          reply = `Lo siento, ${specificTimeQuery} no se encuentra disponible. ¿Te gustaría buscar otro horario?`;
        }
      } else if (availableSlotsOutput.length > 0) {
        let intro = `📅 Estas son algunas horas disponibles`;
        if (targetDateForIntro) {
            intro += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForIntro)}`;
        } else if (availableSlotsOutput.length > 0) {
             intro += ` en los próximos días`;
        }
        if (timeOfDay === 'morning') intro += ' por la mañana';
        if (timeOfDay === 'afternoon') intro += ' por la tarde';
        intro += ':';
        reply = `${intro}\n- ${availableSlotsOutput.slice(0, MAX_SUGGESTIONS).join('\n- ')}`;
        if (availableSlotsOutput.length > MAX_SUGGESTIONS) {
          reply += `\n\n(Y ${availableSlotsOutput.length - MAX_SUGGESTIONS} más...)`;
        }
      } else {
        reply = 'No se encontraron horas disponibles';
        if (targetDateForIntro) {
            reply += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForIntro)}`;
        }
        if (timeOfDay === 'morning') reply += ' por la mañana';
        if (timeOfDay === 'afternoon') reply += ' por la tarde';
        if (targetHourChile !== null && !targetDateForIntro) reply += ` a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`

        if (targetDateForIntro || timeOfDay || targetHourChile) {
             reply += '.';
        } else {
            reply += ' en los próximos 7 días.';
        }
        reply += ' ¿Te gustaría probar con otra búsqueda?';
      }

      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } // Fin if (isCalendarQuery)

    // --- Si no es consulta de calendario, usar OpenAI ---
    console.log('💡 Consulta normal, usando OpenAI');

    // ***** PUNTO DE CORRECCIÓN *****
    // El systemPrompt se define ANTES de la llamada a la API de OpenAI
    const systemPrompt = process.env.RIGBOT_PROMPT || 
`Eres Rigbot, el asistente virtual de la consulta quiropráctica Rigquiropráctico, atendido por el quiropráctico Roberto Ibacache en Copiapó, Chile.
Tu rol es entregar información clara, profesional, cálida y empática a quienes consultan por servicios quiroprácticos, y sugerir horarios disponibles usando el calendario conectado.

No agendas directamente, no recopilas datos personales ni confirmas pagos.
Nunca inventes información. Solo responde con lo que indican estas instrucciones.
Siempre invita al paciente a escribir directamente al WhatsApp 👉 +56 9 8996 7350 para continuar el proceso con un humano.

FUNCIONES PRINCIPALES
- Consultar horarios disponibles mediante la función getAvailableAppointments.
- Sugerir 2 o 3 horarios próximos según disponibilidad.
- Derivar al WhatsApp para agendar, pagar o resolver dudas humanas.
- Entregar información educativa sobre quiropraxia, precios y dirección (según contexto).

LÓGICA DE CONSULTA DE HORARIOS
Todas las horas y fechas deben darse considerando la zona horaria Chile/Continental (America/Santiago).

1️⃣ Si el paciente menciona un día o una semana:
- Llama a getAvailableAppointments con start_date y end_date abarcando ese día o semana.
- Sugiere hasta 3 horarios concretos, idealmente repartidos entre mañana y tarde.
- Finaliza siempre con: Para más información o agendar, por favor escribe directamente al WhatsApp 👉 +56 9 8996 7350

2️⃣ Si pide una hora específica (ej: "a las 16h"):
- Llama a getAvailableAppointments con start_date, end_date y preferred_time con la hora pedida.
- Si hay coincidencia exacta o cercana (±30 min), ofrece:
"A las 16:00 no tengo, pero tengo cerca: 15:30 o 16:30. ¿Te sirve alguno?"
- Si no hay nada cercano, ofrece otras opciones de ese día:
"No tengo disponible a esa hora, pero tengo a las 10:00, 12:30 o 15:00. ¿Quieres alguno?"
- Finaliza siempre con la frase de WhatsApp.

3️⃣ Si el paciente dice "otro día que tengas a las 16h" o "cuando sea":
- Llama a getAvailableAppointments con un rango amplio de fechas y preferred_time: 16:00.
- Si no encuentra horarios, responde:
"No encontré horarios a esa hora en los próximos días. Si quieres, puedo seguir buscando o puedes escribir directamente al WhatsApp 👉 +56 9 8996 7350 para más ayuda."

INFORMACIÓN IMPORTANTE
PRECIOS
1 sesión: $40.000
Pack 2 sesiones: $70.000
Pack 3 sesiones: $100.000
Pack 5 sesiones: $160.000
Pack 10 sesiones: $300.000
Los packs pueden ser compartidos entre personas distintas si se pagan en un solo abono.

DIRECCIÓN
Solo entregar si el paciente ya sabe que debe pagar y lo pide:
Centro de Salud Fleming, Van Buren 129, Copiapó
Ubicación en Google Maps.

¿QUÉ ES LA QUIROPRAXIA?
Si el paciente lo pregunta, comparte este video:
https://youtu.be/EdEZyZUDAw0

ESTILO DE COMUNICACIÓN
Usa siempre un lenguaje amable, claro, empático, cálido y confiable.
Eres un asistente experto y servicial, pero nunca frío ni robótico.`;

    // La llamada a OpenAI que usa el systemPrompt
    const chatResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt }, // Usamos la variable aquí
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
// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const CHILE_UTC_OFFSET_HOURS = -4; 

function convertChileTimeToUtc(baseDateUtcDay, chileHour, chileMinute) {
  let utcHour = chileHour - CHILE_UTC_OFFSET_HOURS;
  const newUtcDate = new Date(baseDateUtcDay);
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
    const isCalendarQuery = lowerMessage.includes('hora') || lowerMessage.includes('turno') || lowerMessage.includes('disponibilidad') || lowerMessage.includes('agenda') || lowerMessage.includes('cuando') || lowerMessage.includes('horario');

    if (isCalendarQuery) {
      console.log('⏳ Detectada consulta de calendario');
      const calendar = await getCalendarClient();
      const serverNowUtc = new Date();

      let targetDateForDisplay = null; 
      let targetHourChile = null;
      let targetMinuteChile = 0;
      let timeOfDay = null;

      const currentYearChile = parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      const currentMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10) -1; 
      const currentDayOfMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      
      const todayChile0000UtcTimestamp = Date.UTC(currentYearChile, currentMonthChile, currentDayOfMonthChile, 0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0);
      const refDateForTargetCalc = new Date(todayChile0000UtcTimestamp);
      const currentDayOfWeekInChile = new Date(Date.UTC(currentYearChile, currentMonthChile, currentDayOfMonthChile)).getUTCDay();

      const isNextWeekQuery = lowerMessage.includes('proxima semana') || lowerMessage.includes('próxima semana');
      if (isNextWeekQuery) {
          // Si pide "próxima semana", fijamos la fecha de inicio al próximo lunes
          targetDateForDisplay = new Date(refDateForTargetCalc);
          const daysUntilNextMonday = (1 - currentDayOfWeekInChile + 7) % 7;
          targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + (daysUntilNextMonday === 0 ? 7 : daysUntilNextMonday) ); // Si hoy es lunes, el próximo lunes
          console.log(`🏷️ Próxima semana detectada, iniciando búsqueda desde: ${targetDateForDisplay.toISOString()}`);
      } else if (lowerMessage.includes('hoy')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + 1);
      } else {
        const dayKeywords = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6 };
        for (const [keyword, dayIndex] of Object.entries(dayKeywords)) {
          if (lowerMessage.includes(keyword)) {
            targetDateForDisplay = new Date(refDateForTargetCalc);
            let daysToAdd = dayIndex - currentDayOfWeekInChile;
            if (daysToAdd < 0 || (daysToAdd === 0 && serverNowUtc.getUTCHours() >= (19 - CHILE_UTC_OFFSET_HOURS))) {
              daysToAdd += 7;
            }
            targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysToAdd);
            break;
          }
        }
      }

      if (targetDateForDisplay) {
        console.log(`🎯 Fecha Objetivo (para mostrar y filtrar): ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} (UTC: ${targetDateForDisplay.toISOString()})`);
      }
      
      const targetDateIdentifierForSlotFilter = targetDateForDisplay ? getDayIdentifier(targetDateForDisplay, 'America/Santiago') : null;
      if(targetDateIdentifierForSlotFilter) console.log(`🏷️ Identificador de Fecha para Filtro de Slots (Chile YYYY-MM-DD): ${targetDateIdentifierForSlotFilter}`);
      
      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30|15|45))?\s*(pm|am|h|hr|hrs)?/i); // Permitir :15 y :45 en la captura
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        // Si se capturó minuto, usarlo, sino default a 0. Si es 15 o 45, se redondeará luego.
        targetMinuteChile = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0; 
        
        const isPm = timeMatch[4] && timeMatch[4].toLowerCase() === 'pm';
        const isAm = timeMatch[4] && timeMatch[4].toLowerCase() === 'am';

        if (isPm && hour >= 1 && hour <= 11) hour += 12;
        if (isAm && hour === 12) hour = 0; 
        // QUITAMOS LA HEURÍSTICA AGRESIVA: if (!isPm && !isAm && hour >= 1 && hour <= 7 && hour !== 0) hour += 12;
        targetHourChile = hour;

        // Redondear minutos a 00 o 30 si se pide algo como :15 o :45
        if (targetMinuteChile > 0 && targetMinuteChile < 30) targetMinuteChile = 0;
        else if (targetMinuteChile > 30 && targetMinuteChile < 60) targetMinuteChile = 30;

        console.log(`⏰ Hora objetivo (Chile): ${targetHourChile}:${targetMinuteChile.toString().padStart(2,'0')}`);
      }

      if (!targetHourChile && !isNextWeekQuery) { // No aplicar franja si se pide "proxima semana" en general
        if ((lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) && !targetHourChile) timeOfDay = 'morning';
        else if (lowerMessage.includes('tarde') && !targetHourChile) timeOfDay = 'afternoon';
        if(timeOfDay) console.log(`🕒 Franja horaria: ${timeOfDay}`);
      }
      
      const WORKING_HOURS_CHILE_NUMERIC = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5];
      if (targetHourChile !== null) {
        const requestedTimeNumeric = targetHourChile + (targetMinuteChile / 60);
        if (!WORKING_HOURS_CHILE_NUMERIC.includes(requestedTimeNumeric) || requestedTimeNumeric < 10 || requestedTimeNumeric > 19.5) {
            let reply = `Lo siento, la hora ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')} está fuera de nuestro horario de atención (10:00 a 19:30).`;
            if (targetDateForDisplay) { 
                reply = `Lo siento, ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')} está fuera de nuestro horario de atención (10:00 a 19:30).`;
            }
            console.log('✅ Respuesta generada (fuera de horario):', reply);
            return res.status(200).json({ response: reply });
        }
      }

      const calendarQueryStartUtc = new Date(serverNowUtc);
      // Si se pide la próxima semana, ajustar el inicio de la búsqueda del calendario
      if (isNextWeekQuery && targetDateForDisplay) {
          calendarQueryStartUtc.setTime(targetDateForDisplay.getTime()); // Iniciar búsqueda desde el lunes de la próxima semana (en UTC)
          console.log(`🗓️ Query de Google Calendar ajustado para próxima semana, desde: ${calendarQueryStartUtc.toISOString()}`);
      }

      const calendarQueryEndUtc = new Date(calendarQueryStartUtc); // Basar el fin en el inicio ajustado
      calendarQueryEndUtc.setDate(calendarQueryEndUtc.getDate() + (isNextWeekQuery ? 14 : 7)); // Buscar 2 semanas si es "prox semana", sino 1
      
      console.log(`🗓️ Google Calendar Query: De ${calendarQueryStartUtc.toISOString()} a ${calendarQueryEndUtc.toISOString()}`);

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
      console.log(`Found ${busySlots.length} busy slots from Google Calendar.`);

      const WORKING_HOURS_CHILE_STR = [
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];
      const availableSlotsOutput = [];
      const processedDaysForGenericQuery = new Set(); // Para evitar repetir días en listado genérico

      // Si es una consulta para "proxima semana" sin día específico, iteramos más días
      const iterationDays = (isNextWeekQuery && !targetDateForDisplay) ? 14 : 7; 
      let baseIterationDate = (isNextWeekQuery && targetDateForDisplay) ? new Date(targetDateForDisplay) : new Date(serverNowUtc);
      // Ajustar baseIterationDate para que sea 00:00 UTC del día de Chile correspondiente
      const baseItYear = parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Santiago' }).format(baseIterationDate), 10);
      const baseItMonth = parseInt(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(baseIterationDate), 10) -1;
      const baseItDay = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Santiago' }).format(baseIterationDate), 10);
      baseIterationDate = new Date(Date.UTC(baseItYear, baseItMonth, baseItDay, 0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0));


      for (let i = 0; i < iterationDays; i++) {
        const currentDayProcessingUtcStart = new Date(baseIterationDate);
        currentDayProcessingUtcStart.setUTCDate(baseIterationDate.getUTCDate() + i);
        // No es necesario setUTCHours(0,0,0,0) aquí porque baseIterationDate ya es 00:00 Chile (en UTC)
        // y sumar días UTC mantiene esa alineación de inicio de día Chile.

        for (const timeChileStr of WORKING_HOURS_CHILE_STR) {
          const [hChile, mChile] = timeChileStr.split(':').map(Number);

          if (targetHourChile !== null) {
            if (hChile !== targetHourChile || mChile !== targetMinuteChile) continue;
          } else if (timeOfDay && !isNextWeekQuery) { // Aplicar franja solo si no es query genérica de "próxima semana"
            if (timeOfDay === 'morning' && (hChile < 10 || hChile >= 14)) continue;
            if (timeOfDay === 'afternoon' && (hChile < 14 || hChile > 19 || (hChile === 19 && mChile > 30))) continue;
          }

          const slotStartUtc = convertChileTimeToUtc(currentDayProcessingUtcStart, hChile, mChile);
          if (isNaN(slotStartUtc.getTime())) { console.error("Slot UTC inválido:", currentDayProcessingUtcStart, hChile, mChile); continue; }
          
          // Asegurarse que el slot no sea antes que "ahora" + un pequeño margen (ej. 5 mins) para evitar ofrecer slots inminentes
          const slightlyFutureServerNowUtc = new Date(serverNowUtc.getTime() + 5 * 60 * 1000);
          if (slotStartUtc < slightlyFutureServerNowUtc) continue;

          const slotDayIdentifierInChile = getDayIdentifier(slotStartUtc, 'America/Santiago');

          if (targetDateIdentifierForSlotFilter) {
            if (slotDayIdentifierInChile !== targetDateIdentifierForSlotFilter) {
              continue; 
            }
          }

          const slotEndUtc = new Date(slotStartUtc);
          slotEndUtc.setUTCMinutes(slotEndUtc.getUTCMinutes() + 30);
          const isBusy = busySlots.some(busy => slotStartUtc.getTime() < busy.end && slotEndUtc.getTime() > busy.start);
          
          if (!isBusy) { 
            const formattedSlot = new Intl.DateTimeFormat('es-CL', {
                weekday: 'long', day: 'numeric', month: 'long',
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago'
            }).format(slotStartUtc);
            
            // Para búsquedas genéricas, asegurar variedad de días si es posible
            if (!targetDateIdentifierForSlotFilter && !targetHourChile) {
                if (availableSlotsOutput.length < MAX_SUGGESTIONS * 2) { // Tomar un poco más para luego elegir
                    if (!processedDaysForGenericQuery.has(slotDayIdentifierInChile) || availableSlotsOutput.length < 2) {
                         availableSlotsOutput.push(formattedSlot);
                         processedDaysForGenericQuery.add(slotDayIdentifierInChile);
                    } else if (Array.from(processedDaysForGenericQuery).length < 3 && availableSlotsOutput.filter(s => s.startsWith(new Intl.DateTimeFormat('es-CL', {weekday: 'long', timeZone: 'America/Santiago'}).format(slotStartUtc))).length < 2) {
                         availableSlotsOutput.push(formattedSlot); // Permitir hasta 2 por día si no tenemos 3 días distintos aún
                    }
                }
            } else {
                 availableSlotsOutput.push(formattedSlot);
            }
          }
        }
        // Si es una búsqueda para un día específico y ya procesamos ese día y encontramos suficientes, o no encontramos, podemos salir antes.
        if (targetDateIdentifierForSlotFilter && getDayIdentifier(currentDayProcessingUtcStart, 'America/Santiago') === targetDateIdentifierForSlotFilter) {
            if (availableSlotsOutput.length > 0 || targetHourChile !== null) break; // Si se buscó hora específica y no se encontró, no seguir.
        }
        if (availableSlotsOutput.length >= MAX_SUGGESTIONS && !targetDateIdentifierForSlotFilter && !targetHourChile && processedDaysForGenericQuery.size >=2) break; // Salir si tenemos suficientes para genérico

      }
      if(targetDateIdentifierForSlotFilter) console.log(`🔎 Slots encontrados para ${targetDateIdentifierForSlotFilter} (después de filtrar): ${availableSlotsOutput.length}`);
      else console.log(`🔎 Slots encontrados en búsqueda general: ${availableSlotsOutput.length}`);
      
      let reply = '';

      if (targetHourChile !== null) { // Respuesta para hora específica
        if (availableSlotsOutput.length > 0) {
          reply = `¡Sí! ${availableSlotsOutput[0]} está disponible. Te recomiendo contactar directamente para confirmar y reservar.`;
        } else {
          let specificTimeQuery = "";
          if(targetDateForDisplay) specificTimeQuery += `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} `;
          specificTimeQuery += `a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
          reply = `Lo siento, ${specificTimeQuery} no se encuentra disponible. ¿Te gustaría buscar otro horario?`;
        }
      } else if (availableSlotsOutput.length > 0) { // Respuesta para día específico o búsqueda general
        let intro = `📅 Estas son algunas horas disponibles`;
        if (targetDateForDisplay) {
            intro += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`;
        } else if (isNextWeekQuery) {
            intro += ` para la próxima semana`;
        } else { 
             intro += ` en los próximos días`;
        }
        if (timeOfDay === 'morning') intro += ' por la mañana';
        if (timeOfDay === 'afternoon') intro += ' por la tarde';
        intro += ':';

        // Asegurar variedad de días en la sugerencia si es búsqueda genérica
        let finalSuggestions = [];
        if (!targetDateForDisplay && !targetHourChile) {
            const slotsByDay = {};
            for (const slot of availableSlotsOutput) {
                const dayName = slot.split(',')[0];
                if (!slotsByDay[dayName]) slotsByDay[dayName] = [];
                if (slotsByDay[dayName].length < 2) slotsByDay[dayName].push(slot); // Max 2 por día
            }
            for (const day in slotsByDay) {
                finalSuggestions.push(...slotsByDay[day]);
                if (finalSuggestions.length >= MAX_SUGGESTIONS) break;
            }
            finalSuggestions = finalSuggestions.slice(0, MAX_SUGGESTIONS);
        } else {
            finalSuggestions = availableSlotsOutput.slice(0, MAX_SUGGESTIONS);
        }

        reply = `${intro}\n- ${finalSuggestions.join('\n- ')}`;
        if (availableSlotsOutput.length > finalSuggestions.length && availableSlotsOutput.length > MAX_SUGGESTIONS) {
           const remaining = availableSlotsOutput.length - finalSuggestions.length;
           reply += `\n\n(Y ${remaining} más...)`;
        } else if (availableSlotsOutput.length > MAX_SUGGESTIONS && finalSuggestions.length === MAX_SUGGESTIONS && availableSlotsOutput.length > finalSuggestions.length) {
            reply += `\n\n(Y ${availableSlotsOutput.length - MAX_SUGGESTIONS} más...)`;
        }


      } else { // No se encontraron slots
        reply = 'No se encontraron horas disponibles';
        if (targetDateForDisplay) {
            reply += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`;
        } else if (isNextWeekQuery) {
            reply += ` para la próxima semana`;
        }
        if (timeOfDay === 'morning') reply += ' por la mañana';
        if (timeOfDay === 'afternoon') reply += ' por la tarde';
        if (targetHourChile !== null && !targetDateForDisplay && !isNextWeekQuery) reply += ` a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`
        
        if (targetDateForDisplay || timeOfDay || targetHourChile || isNextWeekQuery) {
             reply += '.';
        } else { 
            reply += ' en los próximos 7 días.';
        }
        reply += ' ¿Te gustaría probar con otra búsqueda?';
      }
      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } 

    console.log('💡 Consulta normal, usando OpenAI');
    const systemPrompt = process.env.RIGBOT_PROMPT || 
`Eres Rigbot, el asistente virtual de la consulta quiropráctica Rigquiropráctico, atendido por el quiropráctico Roberto Ibacache en Copiapó, Chile.
Tu rol es entregar información clara, profesional, cálida y empática a quienes consultan por servicios quiroprácticos, y sugerir horarios disponibles usando el calendario conectado.

No agendas directamente, no recopilas datos personales ni confirmas pagos.
Nunca inventes información. Solo responde con lo que indican estas instrucciones.
Siempre invita al paciente a escribir directamente al WhatsApp 👉 +56 9 8996 7350 para continuar el proceso con un humano.

FUNCIONES PRINCIPALES
- Si el usuario pregunta por disponibilidad general o para un día/semana/mes específico, consulta los horarios usando la lógica de calendario interna.
- Si se encuentran horarios, sugiere hasta 3-5 horarios concretos. Si el usuario pidió un día/franja específica, enfócate en eso.
- Si el usuario pide una hora específica y está disponible, confírmala.
- Si el usuario pide una hora específica y NO está disponible, informa que no está e idealmente sugiere alternativas cercanas SI LAS HAY para ESE MISMO DÍA. Si no hay alternativas ese día para esa hora, simplemente informa que no está disponible para esa hora y día.
- Si no se encuentran horarios para la consulta específica, informa claramente que no hay disponibilidad para esos criterios.
- Siempre finaliza las consultas de horario (encuentres o no) con: "Para más información o agendar, por favor escribe directamente al WhatsApp 👉 +56 9 8996 7350". No ofrezcas buscar otros horarios tú mismo a menos que el usuario lo pida.

INFORMACIÓN IMPORTANTE
PRECIOS
1 sesión: $40.000
Pack 2 sesiones: $70.000
Pack 3 sesiones: $100.000
Pack 5 sesiones: $160.000
Pack 10 sesiones: $300.000
Los packs pueden ser compartidos entre personas distintas si se pagan en un solo abono.

DIRECCIÓN
Atendemos en Copiapó, en el Centro de Salud Fleming, Van Buren 129.
Si quieres más información o agendar, escribe directamente al WhatsApp 👉 +56 9 8996 7350

¿QUÉ ES LA QUIROPRAXIA?
Si el paciente lo pregunta, comparte este video:
https://youtu.be/EdEZyZUDAw0 (Nota: Este enlace es un placeholder, reemplázalo por el real si existe)

ESTILO DE COMUNICACIÓN
Usa un estilo conversacional cálido, informal pero profesional. 
No repitas siempre la misma estructura. Varía tus respuestas. 
Si un usuario es simpático o usa humor, puedes ser un poco más cercano. 
Nunca seas frío ni robótico. Siempre busca generar una experiencia amable y humana.

Usa siempre un lenguaje amable, claro, empático, cálido y confiable.
Eres un asistente experto y servicial, pero nunca frío ni robótico.`;

    const chatResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
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
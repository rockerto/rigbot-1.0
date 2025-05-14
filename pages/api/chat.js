// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const CHILE_UTC_OFFSET_HOURS = -4; 
const MAX_SUGGESTIONS = 5; 
const MAX_DAYS_TO_QUERY_IN_FUTURE = 21; // Límite de días en el futuro para consultas (ej. 3 semanas)

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

    const calendarKeywords = [ /* ... (tu lista de keywords sigue igual) ... */ 
      'hora', 'turno', 'disponibilidad', 'agenda', 'cuando', 'horario', 
      'disponible', 'libre', 'atiendes', 'ver', 'revisar', 'chequear', 'consultar',
      'lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes', 'sabado', 'sábado', 'domingo',
      'hoy', 'mañana', 
      'tarde', 
      'a las', 
      'para el', 
      'tienes algo', 
      'hay espacio', 
      ' agendar', ' agendamiento' 
    ];
    const isCalendarQuery = calendarKeywords.some(keyword => lowerMessage.includes(keyword));

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
      
      const isProximoQuery = lowerMessage.includes('proximo') || lowerMessage.includes('próximo');
      const isNextWeekQuery = lowerMessage.includes('proxima semana') || lowerMessage.includes('próxima semana');

      if (isNextWeekQuery && !isProximoQuery) { // "proxima semana" general, no "próximo lunes"
          targetDateForDisplay = new Date(refDateForTargetCalc);
          let daysUntilNextMonday = (1 - currentDayOfWeekInChile + 7) % 7;
          if (daysUntilNextMonday === 0 && refDateForTargetCalc <= serverNowUtc) daysUntilNextMonday = 7; // Si hoy es lunes, ir al próximo.
          targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysUntilNextMonday); 
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
            
            if (daysToAdd < 0 || (daysToAdd === 0 && isProximoQuery) || (daysToAdd === 0 && !isProximoQuery && serverNowUtc.getUTCHours() >= (19 - CHILE_UTC_OFFSET_HOURS))) {
              daysToAdd += 7;
            }
            targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysToAdd);
            break;
          }
        }
      }

      if (targetDateForDisplay) {
        console.log(`🎯 Fecha Objetivo (para mostrar y filtrar): ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} (UTC: ${targetDateForDisplay.toISOString()})`);

        // Verificar si la fecha objetivo excede el límite de búsqueda
        const futureLimitDateCheck = new Date(serverNowUtc);
        futureLimitDateCheck.setUTCDate(serverNowUtc.getUTCDate() + MAX_DAYS_TO_QUERY_IN_FUTURE);
        futureLimitDateCheck.setUTCHours(0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0); // Comparar con inicio del día límite en Chile

        if (targetDateForDisplay >= futureLimitDateCheck) {
            const formattedDateAsked = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay);
            let reply = `¡Entiendo que buscas para el ${formattedDateAsked}! 😊 Por ahora, solo puedo revisar la agenda hasta unas ${Math.floor(MAX_DAYS_TO_QUERY_IN_FUTURE / 7)} semanas en el futuro. Para consultas más lejanas, por favor escribe directamente al WhatsApp 👉 +56 9 8996 7350 y te ayudaremos con gusto.`;
            console.log('✅ Respuesta generada (fecha demasiado lejana):', reply);
            return res.status(200).json({ response: reply });
        }
      }
      
      const targetDateIdentifierForSlotFilter = targetDateForDisplay ? getDayIdentifier(targetDateForDisplay, 'America/Santiago') : null;
      // ... (resto de la lógica de extracción de hora, validación de horario laboral, etc. se mantiene igual que en la versión anterior)
      if(targetDateIdentifierForSlotFilter) console.log(`🏷️ Identificador de Fecha para Filtro de Slots (Chile YAML-MM-DD): ${targetDateIdentifierForSlotFilter}`);
      
      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30|15|45))?\s*(pm|am|h|hr|hrs)?/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        targetMinuteChile = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0; 
        const isPm = timeMatch[4] && timeMatch[4].toLowerCase() === 'pm';
        const isAm = timeMatch[4] && timeMatch[4].toLowerCase() === 'am';
        if (isPm && hour >= 1 && hour <= 11) hour += 12;
        if (isAm && hour === 12) hour = 0; 
        targetHourChile = hour;
        if (targetMinuteChile > 0 && targetMinuteChile < 30) targetMinuteChile = 0;
        else if (targetMinuteChile > 30 && targetMinuteChile < 60) targetMinuteChile = 30;
        console.log(`⏰ Hora objetivo (Chile): ${targetHourChile}:${targetMinuteChile.toString().padStart(2,'0')}`);
      }
      if (!targetHourChile && !isNextWeekQuery && !isProximoQuery) { // No aplicar franja si es "prox semana" o "prox [dia]"
        if ((lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) && !targetHourChile) {
             if (targetDateForDisplay && getDayIdentifier(targetDateForDisplay, 'America/Santiago') === getDayIdentifier(new Date(refDateForTargetCalc.getTime() + 24*60*60*1000), 'America/Santiago')) {
                timeOfDay = 'morning';
             }
        } else if (lowerMessage.includes('tarde') && !targetHourChile) {
            timeOfDay = 'afternoon';
        }
        if(timeOfDay) console.log(`🕒 Franja horaria: ${timeOfDay}`);
      }
      
      const WORKING_HOURS_CHILE_NUMERIC = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5];
      if (targetHourChile !== null) {
        const requestedTimeNumeric = targetHourChile + (targetMinuteChile / 60);
        if (!WORKING_HOURS_CHILE_NUMERIC.includes(requestedTimeNumeric) || requestedTimeNumeric < 10 || requestedTimeNumeric > 19.5) {
            let reply = `¡Ojo! 👀 Parece que las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
            if (targetDateForDisplay) { 
                reply = `¡Ojo! 👀 Parece que el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
            }
            reply += ` está fuera de nuestro horario de atención (que es de 10:00 a 19:30). ¿Te gustaría buscar dentro de ese rango?`;
            console.log('✅ Respuesta generada (fuera de horario):', reply);
            return res.status(200).json({ response: reply });
        }
      }

      let calendarQueryStartUtc = new Date(serverNowUtc);
      let queryDays = 7; // Por defecto buscar 7 días

      if (targetDateForDisplay) { // Si se determinó un día específico (hoy, mañana, lunes prox, etc.)
          calendarQueryStartUtc.setTime(targetDateForDisplay.getTime());
          // Si es "proxima semana" general, targetDateForDisplay ya es Lunes prox. Buscamos 7 o 14 días desde ahí.
          if (isNextWeekQuery && !targetDateIdentifierForSlotFilter) { // "proxima semana" general
            queryDays = 14; 
          } else { // Día específico
            queryDays = 7; // Para un día específico, 7 días desde ese día es suficiente (o incluso menos)
          }
      } else if (isNextWeekQuery) { // "proxima semana" pero no se pudo fijar el lunes (raro, pero por si acaso)
          // Calcular inicio del próximo lunes y buscar 14 días
          let tempStartDate = new Date(refDateForTargetCalc);
          const daysUntilNextMonday = (1 - currentDayOfWeekInChile + 7) % 7;
          tempStartDate.setUTCDate(tempStartDate.getUTCDate() + (daysUntilNextMonday === 0 ? 7 : daysUntilNextMonday));
          calendarQueryStartUtc.setTime(tempStartDate.getTime());
          queryDays = 14;
      }
      // Si no hay targetDateForDisplay y no es isNextWeekQuery, se busca desde serverNowUtc por 7 días.
      
      const calendarQueryEndUtc = new Date(calendarQueryStartUtc);
      calendarQueryEndUtc.setUTCDate(calendarQueryStartUtc.getUTCDate() + queryDays);
      
      console.log(`🗓️ Google Calendar Query: De ${calendarQueryStartUtc.toISOString()} a ${calendarQueryEndUtc.toISOString()}`);

      const googleResponse = await calendar.events.list({ /* ... */ }); // Misma query que antes
      const busySlots = googleResponse.data.items /* ... */ .filter(Boolean); // Misma lógica de busySlots
      // ... (resto del código para generar availableSlotsOutput y reply se mantiene igual que en la versión anterior exitosa)
      // ... Asegúrate de copiar esa parte correctamente desde la versión anterior ...
      // COMIENZO DE LÓGICA DE SLOTS Y REPLY (igual a la versión anterior funcional)
      console.log(`Found ${busySlots.length} busy slots from Google Calendar.`);
      if (busySlots.length > 0 && (targetDateIdentifierForSlotFilter || isNextWeekQuery)) { // Solo loguear si es relevante para la consulta
        console.log("DEBUG: Contenido de busySlots relevantes (eventos UTC de Google Calendar):");
        busySlots.forEach((bs, index) => {
          // Loguear solo si el evento se solapa con el rango de la consulta real
          const eventStartDate = new Date(bs.start);
          const eventEndDate = new Date(bs.end);
          if (eventEndDate > calendarQueryStartUtc && eventStartDate < calendarQueryEndUtc) {
            console.log(`  BusySlot ${index}: Start: ${eventStartDate.toISOString()}, End: ${eventEndDate.toISOString()}`);
          }
        });
      }

      const WORKING_HOURS_CHILE_STR = [
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];
      const availableSlotsOutput = [];
      const processedDaysForGenericQuery = new Set(); 

      const iterationDays = queryDays; // Usar los días calculados para la query
      
      let baseIterationDateDayUtcStart;
      // La base para iterar slots siempre será el inicio de la query de GCal, normalizado a 00:00 Chile UTC
      const baseItYear = parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Santiago' }).format(calendarQueryStartUtc), 10);
      const baseItMonth = parseInt(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(calendarQueryStartUtc), 10) -1;
      const baseItDay = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Santiago' }).format(calendarQueryStartUtc), 10);
      baseIterationDateDayUtcStart = new Date(Date.UTC(baseItYear, baseItMonth, baseItDay, 0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0));


      for (let i = 0; i < iterationDays; i++) {
        const currentDayProcessingUtcStart = new Date(baseIterationDateDayUtcStart);
        currentDayProcessingUtcStart.setUTCDate(baseIterationDateDayUtcStart.getUTCDate() + i);
        
        for (const timeChileStr of WORKING_HOURS_CHILE_STR) {
          const [hChile, mChile] = timeChileStr.split(':').map(Number);

          if (targetHourChile !== null) {
            if (hChile !== targetHourChile || mChile !== targetMinuteChile) continue;
          } else if (timeOfDay && !(isNextWeekQuery && !targetDateIdentifierForSlotFilter) ) { 
            if (timeOfDay === 'morning' && (hChile < 10 || hChile >= 14)) continue;
            if (timeOfDay === 'afternoon' && (hChile < 14 || hChile > 19 || (hChile === 19 && mChile > 30))) continue;
          }

          const slotStartUtc = convertChileTimeToUtc(currentDayProcessingUtcStart, hChile, mChile);
          if (isNaN(slotStartUtc.getTime())) { console.error("Slot UTC inválido:", currentDayProcessingUtcStart, hChile, mChile); continue; }
          
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
            
            if (!targetDateIdentifierForSlotFilter && !targetHourChile) { 
                if (availableSlotsOutput.length < 10) { 
                    if (!processedDaysForGenericQuery.has(slotDayIdentifierInChile) || availableSlotsOutput.length < 2) {
                         availableSlotsOutput.push(formattedSlot);
                         processedDaysForGenericQuery.add(slotDayIdentifierInChile);
                    } else if (Array.from(processedDaysForGenericQuery).length < 3 && availableSlotsOutput.filter(s => s.startsWith(new Intl.DateTimeFormat('es-CL', {weekday: 'long', timeZone: 'America/Santiago'}).format(slotStartUtc))).length < 2) {
                         availableSlotsOutput.push(formattedSlot);
                    }
                }
            } else { 
                 availableSlotsOutput.push(formattedSlot);
            }
          }
        }
        if (targetDateIdentifierForSlotFilter && getDayIdentifier(currentDayProcessingUtcStart, 'America/Santiago') === targetDateIdentifierForSlotFilter) {
            if (targetHourChile !== null || availableSlotsOutput.length >= MAX_SUGGESTIONS ) break; 
        }
        if (availableSlotsOutput.length >= MAX_SUGGESTIONS && !targetDateIdentifierForSlotFilter && !targetHourChile && processedDaysForGenericQuery.size >=2) break; 
      }
      
      if(targetDateIdentifierForSlotFilter) {
          console.log(`🔎 Slots encontrados para el día de Chile ${targetDateIdentifierForSlotFilter}: ${availableSlotsOutput.length}`);
      } else {
          console.log(`🔎 Slots encontrados en búsqueda general (próximos ${iterationDays} días): ${availableSlotsOutput.length}`);
      }
      
      let reply = '';

      if (targetHourChile !== null) { 
        if (availableSlotsOutput.length > 0) {
          reply = `¡Excelente! 🎉 Justo el ${availableSlotsOutput[0]} está libre para ti. ¡Qué buena suerte! Para asegurar tu cita, contáctanos directamente y la reservamos. 😉`;
        } else {
          let specificTimeQuery = "";
          if(targetDateForDisplay) specificTimeQuery += `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} `;
          specificTimeQuery += `a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
          reply = `¡Uy! Justo ${specificTimeQuery} no me quedan espacios. 😕 ¿Te gustaría que revise otro horario o quizás otro día?`;
        }
      } else if (availableSlotsOutput.length > 0) { 
        let intro = `¡Buenas noticias! 🎉 Encontré estas horitas disponibles`;
        if (targetDateForDisplay) {
            intro += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`;
        } else if (isNextWeekQuery) { // Esta condición es para cuando el usuario pide "proxima semana" sin especificar día
            intro += ` para la próxima semana`;
        } else { 
             intro += ` en los próximos días`;
        }
        if (timeOfDay === 'morning') intro += ' por la mañana';
        if (timeOfDay === 'afternoon') intro += ' por la tarde';
        intro += '. ¡A ver si alguna te acomoda! 🥳:';

        let finalSuggestions = [];
        if (!targetDateIdentifierForSlotFilter && !targetHourChile) { 
            const slotsByDay = {};
            for (const slot of availableSlotsOutput) {
                const dayName = slot.split(',')[0]; 
                if (!slotsByDay[dayName]) slotsByDay[dayName] = [];
                if (slotsByDay[dayName].length < 2) { 
                    slotsByDay[dayName].push(slot);
                }
            }
            let count = 0;
            for (const day in slotsByDay) { 
                for(const slot of slotsByDay[day]){
                    if(count < MAX_SUGGESTIONS){
                        finalSuggestions.push(slot);
                        count++;
                    } else {
                        break; 
                    }
                }
                if (count >= MAX_SUGGESTIONS) break; 
            }
        } else { 
            finalSuggestions = availableSlotsOutput.slice(0, MAX_SUGGESTIONS);
        }

        reply = `${intro}\n- ${finalSuggestions.join('\n- ')}`;
        
        if (availableSlotsOutput.length > finalSuggestions.length) {
           const remaining = availableSlotsOutput.length - finalSuggestions.length;
           if (remaining > 0) {
             reply += `\n\n(Y ${remaining} más... ¡para que tengas de dónde elegir! 😉)`;
           }
        }
      } else { 
        reply = '¡Pucha! 😔 Parece que no tengo horas libres';
        if (targetDateForDisplay) {
            reply += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`;
        } else if (isNextWeekQuery) { // Si la consulta fue para la próxima semana y no se encontró nada
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
        reply += ' ¿Te animas a que busquemos en otra fecha u horario? ¡Seguro encontramos algo! 👍';
      }
      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } // Fin if (isCalendarQuery)

    // --- Si no es consulta de calendario, usar OpenAI ---
    // ... (El resto del código para OpenAI se mantiene igual)
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
    console.error(error.stack); // Asegúrate de que esto esté aquí para ver el stacktrace completo
    return res.status(500).json({ error: 'Ocurrió un error en Rigbot. ' + error.message });
  }
}
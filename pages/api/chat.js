// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const CHILE_UTC_OFFSET_HOURS = -4; 
const MAX_SUGGESTIONS = 5; 
const DAYS_TO_QUERY_CALENDAR = 7; 
const MAX_DAYS_FOR_USER_REQUEST = 21; 

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

    const calendarKeywords = [
      'hora', 'turno', 'disponibilidad', 'agenda', 'cuando', 'horario', 
      'disponible', 'libre', 'atiendes', 'ver', 'revisar', 'chequear', 'consultar',
      'lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes', 'sabado', 'sábado', 'domingo',
      'hoy', 'mañana', 'tarde', 'a las', 'para el', 'tienes algo', 'hay espacio', 
      'agendar', 'agendamiento',
      'proxima semana', 'próxima semana', 'prixima semana', 'procsima semana', 'proxima semama',
      'proximo', 'próximo', 'priximo', 'procsimo'
    ];
    const isCalendarQuery = calendarKeywords.some(keyword => lowerMessage.includes(keyword));

    if (isCalendarQuery) {
      console.log('⏳ Detectada consulta de calendario');
      const calendar = await getCalendarClient();
      const serverNowUtc = new Date();

      let targetDateForDisplay = null; 
      let targetDateIdentifierForSlotFilter = null; // Clave para búsqueda genérica de semana
      let targetHourChile = null;
      let targetMinuteChile = 0;
      let timeOfDay = null;
      let isGenericSearch = false; // Bandera para saber si no se especificó día

      const currentYearChile = parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      const currentMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10) -1; 
      const currentDayOfMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      
      const todayChile0000UtcTimestamp = Date.UTC(currentYearChile, currentMonthChile, currentDayOfMonthChile, 0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0);
      const refDateForTargetCalc = new Date(todayChile0000UtcTimestamp);
      const actualCurrentDayOfWeekInChile = refDateForTargetCalc.getUTCDay();
      
      const isProximoWordQuery = calendarKeywords.some(k => k.startsWith("proximo") && lowerMessage.includes(k));
      const isAnyNextWeekIndicator = calendarKeywords.some(k => k.includes("semana") && lowerMessage.includes(k));

      let specificDayKeywordIndex = -1;
      const dayKeywordsList = [ 
        { keyword: 'domingo', index: 0 }, { keyword: 'lunes', index: 1 }, { keyword: 'martes', index: 2 }, 
        { keyword: 'miercoles', index: 3 }, { keyword: 'miércoles', index: 3 }, { keyword: 'jueves', index: 4 }, 
        { keyword: 'viernes', index: 5 }, { keyword: 'sabado', index: 6 }, { keyword: 'sábado', index: 6 }
      ];
      for (const dayInfo of dayKeywordsList) { if (lowerMessage.includes(dayInfo.keyword)) { specificDayKeywordIndex = dayInfo.index; break; } }

      if (lowerMessage.includes('hoy')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + 1);
      } else if (specificDayKeywordIndex !== -1) { // Se mencionó un día de la semana
        targetDateForDisplay = new Date(refDateForTargetCalc);
        let daysToAdd = specificDayKeywordIndex - actualCurrentDayOfWeekInChile;
        if (daysToAdd < 0) { 
          daysToAdd += 7; 
        }
        if ((isAnyNextWeekIndicator && daysToAdd < 7) || (daysToAdd === 0 && isProximoWordQuery)) {
          daysToAdd += 7;
        } else if (daysToAdd === 0 && !isProximoWordQuery && serverNowUtc.getUTCHours() >= (19 - CHILE_UTC_OFFSET_HOURS)) {
          daysToAdd += 7;
        }
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysToAdd);
      } else if (isAnyNextWeekIndicator) { // "próxima semana" genérico
          targetDateForDisplay = new Date(refDateForTargetCalc);
          let daysUntilNextMonday = (1 - actualCurrentDayOfWeekInChile + 7) % 7;
          if (daysUntilNextMonday === 0) daysUntilNextMonday = 7; 
          targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysUntilNextMonday); 
          isGenericSearch = true; // Marcar para que no filtre por día específico
      }
      // Si targetDateForDisplay es null, la búsqueda será genérica desde hoy y targetDateIdentifierForSlotFilter será null.

      if (targetDateForDisplay) {
        console.log(`🎯 Fecha Objetivo (para mostrar y filtrar): ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} (UTC: ${targetDateForDisplay.toISOString()})`);
        const futureLimitCheckDate = new Date(refDateForTargetCalc); 
        futureLimitCheckDate.setUTCDate(futureLimitCheckDate.getUTCDate() + MAX_DAYS_FOR_USER_REQUEST);
        if (targetDateForDisplay >= futureLimitCheckDate) {
            const formattedDateAsked = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay);
            let reply = `¡Entiendo que buscas para el ${formattedDateAsked}! 😊 Por ahora, mi calendario mental llega hasta unos ${MAX_DAYS_FOR_USER_REQUEST} días en el futuro (aprox. ${Math.floor(MAX_DAYS_FOR_USER_REQUEST / 7)} semanas). Para consultas más allá de esa fecha, por favor escribe directamente al WhatsApp 👉 +56 9 8996 7350 y mis colegas humanos te ayudarán con gusto.`;
            console.log('✅ Respuesta generada (fecha demasiado lejana):', reply);
            return res.status(200).json({ response: reply }); 
        }
      }
      
      // Ajuste: targetDateIdentifierForSlotFilter es null si es búsqueda genérica de próxima semana o búsqueda genérica desde hoy
      targetDateIdentifierForSlotFilter = (targetDateForDisplay && !isGenericSearch) ? getDayIdentifier(targetDateForDisplay, 'America/Santiago') : null;
      
      if(targetDateIdentifierForSlotFilter) {
        console.log(`🏷️ Identificador de Fecha para Filtro de Slots (Chile YAML-MM-DD): ${targetDateIdentifierForSlotFilter}`);
      } else if (targetDateForDisplay && isGenericSearch) { // "próxima semana" genérico
        console.log(`🏷️ Búsqueda genérica para la semana que comienza el ${getDayIdentifier(targetDateForDisplay, 'America/Santiago')}, sin filtro de día específico.`);
      } else {
        console.log(`🏷️ Búsqueda genérica desde hoy, sin filtro de día específico.`);
      }
      
      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30|15|45))?\s*(pm|am|h|hr|hrs)?/i);
      if (timeMatch) { /* ... (lógica de extracción de hora igual) ... */ }
      if (!targetHourChile && !isAnyNextWeekIndicator && !isProximoWordQuery && !(targetDateForDisplay && getDayIdentifier(targetDateForDisplay, 'America/Santiago') !== getDayIdentifier(refDateForTargetCalc, 'America/Santiago'))) { 
        /* ... (lógica de timeOfDay igual) ... */
      }
      if (targetHourChile !== null) { /* ... (validación de horario laboral igual, pero el reply no debe tener el footer repetido)... */
        const requestedTimeNumeric = targetHourChile + (targetMinuteChile / 60);
        if (!WORKING_HOURS_CHILE_NUMERIC.includes(requestedTimeNumeric) || requestedTimeNumeric < 10 || requestedTimeNumeric > 19.5) {
            let reply = `¡Ojo! 👀 Parece que las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
            if (targetDateForDisplay) { 
                reply = `¡Ojo! 👀 Parece que el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
            }
            reply += ` está fuera de nuestro horario de atención (que es de 10:00 a 19:30). ¿Te gustaría buscar dentro de ese rango? Si prefieres, para más ayuda, contáctanos por WhatsApp 👉 +56 9 8996 7350.`;
            console.log('✅ Respuesta generada (fuera de horario):', reply);
            return res.status(200).json({ response: reply });
        }
      }

      let calendarQueryStartUtc;
      if (targetDateForDisplay) { 
          calendarQueryStartUtc = new Date(targetDateForDisplay.getTime());
      } else { 
          calendarQueryStartUtc = new Date(refDateForTargetCalc.getTime()); 
      }
      const calendarQueryEndUtc = new Date(calendarQueryStartUtc);
      calendarQueryEndUtc.setUTCDate(calendarQueryStartUtc.getUTCDate() + DAYS_TO_QUERY_CALENDAR); 
      console.log(`🗓️ Google Calendar Query: De ${calendarQueryStartUtc.toISOString()} a ${calendarQueryEndUtc.toISOString()}`);
      
      const googleResponse = await calendar.events.list({ /* ... */ });
      const busySlots = googleResponse.data.items.filter(e => e.status !== 'cancelled')
        .map(e => { /* ... */ }).filter(Boolean);
      console.log(`Found ${busySlots.length} busy slots.`);
      if (busySlots.length > 0 ) { /* ... log de busySlots ... */ }

      const WORKING_HOURS_CHILE_STR = [ /* ... */ ];
      const availableSlotsOutput = [];
      const processedDaysForGenericQuery = new Set();       
      let baseIterationDateDayUtcStart;
      if (targetDateForDisplay) { baseIterationDateDayUtcStart = new Date(targetDateForDisplay); } 
      else { baseIterationDateDayUtcStart = new Date(refDateForTargetCalc); }

      for (let i = 0; i < DAYS_TO_QUERY_CALENDAR; i++) { /* ... (bucle interno igual que en #44) ... */ }
      
      if(targetDateIdentifierForSlotFilter) { /* ... */ } 
      else { console.log(`🔎 Slots encontrados en búsqueda genérica (próximos ${DAYS_TO_QUERY_CALENDAR} días): ${availableSlotsOutput.length}`); }
      
      let reply = ''; // Reply se construye aquí
      // ... (Lógica de construcción de reply igual que en respuesta #44, usando targetDateForDisplay y los textos mejorados) ...
      // ***** NO AÑADIR scheduleFooterMessage aquí automáticamente *****

      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } 

    // --- Si no es consulta de calendario, usar OpenAI ---
    console.log('💡 Consulta normal, usando OpenAI');
    const systemPrompt = process.env.RIGBOT_PROMPT || 
`Eres Rigbot, el asistente virtual de la consulta quiropráctica Rigquiropráctico, atendido por el quiropráctico Roberto Ibacache en Copiapó, Chile.
Tu rol es entregar información clara, profesional, cálida y empática a quienes consultan por servicios quiroprácticos. Si se consulta por horarios, usa la información del calendario conectado.

CAPACIDADES DE HORARIOS:
- Cuando me preguntes por horarios, puedo revisar la disponibilidad para los próximos ${DAYS_TO_QUERY_CALENDAR} días aproximadamente, comenzando desde la fecha que me indiques (o desde hoy si no especificas).
- Si el usuario pide un día o franja específica dentro de ese rango, me enfocaré en eso.
- Si pide una hora específica y está disponible, la confirmaré.
- Si una hora específica NO está disponible, informaré y puedo sugerir alternativas cercanas para ESE MISMO DÍA si las hay.
- Si no se encuentran horarios para los criterios dentro de mi rango de búsqueda, lo informaré claramente.
- **IMPORTANTE:** Si el usuario pregunta por fechas más allá de los ${DAYS_TO_QUERY_CALENDAR} días que puedo ver claramente, o si la búsqueda es muy compleja, o para agendar y pagar, indícale amablemente que para esos casos es mejor que escriba directamente al WhatsApp.

DERIVACIÓN A WHATSAPP (EJEMPLOS, varía la frase para que suene natural):
- "Para más detalles, confirmar tu hora o si buscas más allá de la próxima semana, conversemos por WhatsApp 👉 +56 9 8996 7350 ¡Te esperamos!"
- "Si este horario te acomoda o necesitas ver otras opciones, escríbenos a WhatsApp 👉 +56 9 8996 7350 y coordinamos."
- "Para agendar o cualquier otra consulta, nuestro equipo te espera en WhatsApp 👉 +56 9 8996 7350."

INFO GENERAL (Solo si se pregunta directamente):
PRECIOS: 1 sesión: $40.000, Pack 2: $70.000, Pack 3: $100.000, Pack 5: $160.000, Pack 10: $300.000. Packs compartibles con pago único.
DIRECCIÓN: Centro de Salud Fleming, Van Buren 129, Copiapó. (Solo entregar si ya se ha hablado de agendar o pagar, e invitar a WhatsApp para confirmar).
QUIROPRAXIA VIDEO: Si preguntan qué es, comparte https://youtu.be/EdEZyZUDAw0 (placeholder) y explica brevemente.

TONO:
Alegre, cálido, empático, servicial y profesional, pero cercano. Evita ser robótico. Adapta tu entusiasmo al del usuario. Usa emojis con moderación para realzar el tono. 🎉😊👍👀🥳`;

    const chatResponse = await openai.chat.completions.create({ /* ... */ });
    const gptReply = chatResponse.choices[0].message.content.trim();
    return res.status(200).json({ response: gptReply });

  } catch (error) { /* ... */ }
}
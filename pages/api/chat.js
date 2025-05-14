// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const CHILE_UTC_OFFSET_HOURS = -4; 
const MAX_SUGGESTIONS = 5; 
const DAYS_TO_QUERY_CALENDAR = 7; // Cuántos días buscará y sobre cuántos informará como límite
const MAX_DAYS_FOR_USER_REQUEST = 21; // Si el usuario pide más allá de esto, mensaje especial

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
      'agendar', 'agendamiento', // Quitado el espacio inicial
      'proxima semana', 'próxima semana', 'prixima semana', // Añadido "prixima"
      'proximo', 'próximo', 'priximo' // Añadido "priximo"
    ];
    const isCalendarQuery = calendarKeywords.some(keyword => lowerMessage.includes(keyword));

    // Mensaje estándar para agregar al final de las respuestas de calendario
    const scheduleFooterMessage = `\n\nRecuerda que puedo revisar horarios hasta unos ${DAYS_TO_QUERY_CALENDAR} días desde la fecha que consultes. Para fechas más lejanas o cualquier otra duda, ¡escríbenos por WhatsApp al 👉 +56 9 8996 7350 y te ayudamos! 😊`;

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
      const actualCurrentDayOfWeekInChile = refDateForTargetCalc.getUTCDay();
      
      const isProximoQuery = lowerMessage.includes('proximo') || lowerMessage.includes('próximo') || lowerMessage.includes('priximo');
      const isNextWeekQuery = lowerMessage.includes('proxima semana') || lowerMessage.includes('próxima semana') || lowerMessage.includes('prixima semana');

      let specificDayKeywordIndex = -1;
      const dayKeywords = [ 
        { keyword: 'domingo', index: 0 }, { keyword: 'lunes', index: 1 }, 
        { keyword: 'martes', index: 2 }, { keyword: 'miercoles', index: 3 }, 
        { keyword: 'miércoles', index: 3 }, { keyword: 'jueves', index: 4 }, 
        { keyword: 'viernes', index: 5 }, { keyword: 'sabado', index: 6 }, { keyword: 'sábado', index: 6 }
      ];

      for (const dayInfo of dayKeywords) {
        if (lowerMessage.includes(dayInfo.keyword)) {
          specificDayKeywordIndex = dayInfo.index;
          break;
        }
      }

      if (specificDayKeywordIndex !== -1) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
        let daysToAdd = specificDayKeywordIndex - actualCurrentDayOfWeekInChile;
        if (daysToAdd < 0) { 
          daysToAdd += 7;
        }
        if ((isNextWeekQuery && daysToAdd < 7) || (daysToAdd === 0 && isProximoQuery)) {
          daysToAdd += 7;
        } else if (daysToAdd === 0 && !isProximoQuery && serverNowUtc.getUTCHours() >= (19 - CHILE_UTC_OFFSET_HOURS)) {
          daysToAdd += 7;
        }
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysToAdd);
      } else if (isNextWeekQuery) { 
          targetDateForDisplay = new Date(refDateForTargetCalc);
          let daysUntilNextMonday = (1 - actualCurrentDayOfWeekInChile + 7) % 7;
          if (daysUntilNextMonday === 0) daysUntilNextMonday = 7; 
          targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysUntilNextMonday); 
      } else if (lowerMessage.includes('hoy')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + 1);
      }
      
      if (targetDateForDisplay) {
        console.log(`🎯 Fecha Objetivo (para mostrar y filtrar): ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} (UTC: ${targetDateForDisplay.toISOString()})`);
        
        const futureQueryLimitStart = new Date(refDateForTargetCalc); // Hoy 00:00 Chile
        const futureQueryLimitEnd = new Date(futureQueryLimitStart);
        futureQueryLimitEnd.setUTCDate(futureQueryLimitStart.getUTCDate() + MAX_DAYS_FOR_USER_REQUEST);

        if (targetDateForDisplay >= futureQueryLimitEnd) {
            const formattedDateAsked = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay);
            let reply = `¡Entiendo que buscas para el ${formattedDateAsked}! 😊 Por ahora, mi calendario mental llega hasta unos ${MAX_DAYS_FOR_USER_REQUEST} días en el futuro. Para consultas más allá de esa fecha, por favor escribe directamente al WhatsApp 👉 +56 9 8996 7350 y mis colegas humanos te ayudarán con gusto.`;
            console.log('✅ Respuesta generada (fecha demasiado lejana):', reply);
            return res.status(200).json({ response: reply });
        }
      }
      
      const targetDateIdentifierForSlotFilter = targetDateForDisplay ? getDayIdentifier(targetDateForDisplay, 'America/Santiago') : null;
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
      if (!targetHourChile && !isNextWeekQuery && !isProximoQuery && !(targetDateForDisplay && targetDateForDisplay > refDateForTargetCalc) ) { 
        if ((lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana'))) {
             if (targetDateForDisplay && getDayIdentifier(targetDateForDisplay, 'America/Santiago') === getDayIdentifier(new Date(refDateForTargetCalc.getTime() + 24*60*60*1000), 'America/Santiago')) {
                timeOfDay = 'morning';
             }
        } else if (lowerMessage.includes('tarde')) {
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
            return res.status(200).json({ response: reply + scheduleFooterMessage });
        }
      }

      let calendarQueryStartUtc;
      if (targetDateForDisplay) { 
          calendarQueryStartUtc = new Date(targetDateForDisplay.getTime());
      } else { 
          calendarQueryStartUtc = new Date(refDateForTargetCalc.getTime()); // Si no hay día específico, empieza desde hoy (00:00 Chile)
      }
      
      const calendarQueryEndUtc = new Date(calendarQueryStartUtc);
      calendarQueryEndUtc.setUTCDate(calendarQueryStartUtc.getUTCDate() + DAYS_TO_QUERY_CALENDAR); 
      
      console.log(`🗓️ Google Calendar Query: De ${calendarQueryStartUtc.toISOString()} a ${calendarQueryEndUtc.toISOString()}`);

      const googleResponse = await calendar.events.list({
        calendarId: 'primary',
        timeMin: calendarQueryStartUtc.toISOString(),
        timeMax: calendarQueryEndUtc.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const busySlots = googleResponse.data.items.filter(e => e.status !== 'cancelled')
        .map(e => { /* ... (igual) ... */ }).filter(Boolean);
      console.log(`Found ${busySlots.length} busy slots.`);
      // ... (log de DEBUG de busySlots igual) ...

      const WORKING_HOURS_CHILE_STR = [ /* ... (igual) ... */ ];
      const availableSlotsOutput = [];
      const processedDaysForGenericQuery = new Set(); 
      
      let baseIterationDateDayUtcStart = new Date(calendarQueryStartUtc);
      baseIterationDateDayUtcStart.setUTCHours(0 - CHILE_UTC_OFFSET_HOURS, 0,0,0); // Asegurar que sea 00:00 Chile UTC


      for (let i = 0; i < DAYS_TO_QUERY_CALENDAR; i++) { // Iterar solo los días que consultamos
        const currentDayProcessingUtcStart = new Date(baseIterationDateDayUtcStart);
        currentDayProcessingUtcStart.setUTCDate(baseIterationDateDayUtcStart.getUTCDate() + i);
        
        // ... (resto del bucle de generación de slots igual, usando slotDayIdentifierInChile y targetDateIdentifierForSlotFilter)
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
            const formattedSlot = new Intl.DateTimeFormat('es-CL', { /* ... */ }).format(slotStartUtc); // igual
            if (!targetDateIdentifierForSlotFilter && !targetHourChile) { /* ... (igual) ... */ }
            else { availableSlotsOutput.push(formattedSlot); }
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
          console.log(`🔎 Slots encontrados en búsqueda general (próximos ${DAYS_TO_QUERY_CALENDAR} días): ${availableSlotsOutput.length}`);
      }
      
      let reply = '';

      if (targetHourChile !== null) { /* ... (igual, con textos mejorados) ... */ }
      else if (availableSlotsOutput.length > 0) { /* ... (igual, con textos mejorados) ... */ }
      else { /* ... (igual, con textos mejorados) ... */ }

      // Añadir siempre el scheduleFooterMessage
      reply += scheduleFooterMessage;

      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } 

    // --- Si no es consulta de calendario, usar OpenAI ---
    // ... (código OpenAI se mantiene igual)
    console.log('💡 Consulta normal, usando OpenAI');
    const systemPrompt = process.env.RIGBOT_PROMPT || `Eres Rigbot... (tu prompt completo aquí) ...`;
    const chatResponse = await openai.chat.completions.create({ /* ... */ });
    const gptReply = chatResponse.choices[0].message.content.trim();
    return res.status(200).json({ response: gptReply });

  } catch (error) {
    console.error('❌ Error en Rigbot:', error);
    console.error(error.stack); 
    return res.status(500).json({ error: 'Ocurrió un error en Rigbot. ' + error.message });
  }
}
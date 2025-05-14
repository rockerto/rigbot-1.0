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

    const calendarKeywords = [ /* ... (tu lista completa de keywords) ... */ ];
    const isCalendarQuery = calendarKeywords.some(keyword => lowerMessage.includes(keyword));

    if (isCalendarQuery) {
      console.log('⏳ Detectada consulta de calendario');
      let calendar;
      try {
        calendar = await getCalendarClient();
        if (!calendar || typeof calendar.events?.list !== 'function') {
            console.error("Error: getCalendarClient() no devolvió un cliente de calendario válido.");
            throw new Error("Cliente de calendario no inicializado correctamente.");
        }
      } catch (clientError) {
        console.error("❌ Error al obtener el cliente de Google Calendar:", clientError);
        return res.status(500).json({ error: 'No se pudo conectar con el servicio de calendario.', details: clientError.message });
      }
      
      const serverNowUtc = new Date();
      let targetDateForDisplay = null; 
      let targetDateIdentifierForSlotFilter = null;
      let targetHourChile = null;
      let targetMinuteChile = 0;
      let timeOfDay = null;
      let isGenericSearch = false;

      const currentYearChile = parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      const currentMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10) -1; 
      const currentDayOfMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      const todayChile0000UtcTimestamp = Date.UTC(currentYearChile, currentMonthChile, currentDayOfMonthChile, 0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0);
      const refDateForTargetCalc = new Date(todayChile0000UtcTimestamp);
      const actualCurrentDayOfWeekInChile = refDateForTargetCalc.getUTCDay();
      const isProximoWordQuery = calendarKeywords.some(k => k.startsWith("proximo") && lowerMessage.includes(k));
      const isAnyNextWeekIndicator = calendarKeywords.some(k => k.includes("semana") && lowerMessage.includes(k));
      let specificDayKeywordIndex = -1;
      const dayKeywordsList = [ { keyword: 'domingo', index: 0 }, { keyword: 'lunes', index: 1 }, { keyword: 'martes', index: 2 }, { keyword: 'miercoles', index: 3 }, { keyword: 'miércoles', index: 3 }, { keyword: 'jueves', index: 4 }, { keyword: 'viernes', index: 5 }, { keyword: 'sabado', index: 6 }, { keyword: 'sábado', index: 6 }];
      for (const dayInfo of dayKeywordsList) { if (lowerMessage.includes(dayInfo.keyword)) { specificDayKeywordIndex = dayInfo.index; break; } }

      if (lowerMessage.includes('hoy')) { /* ... (lógica de fecha igual que #50) ... */ }
      // ... (resto de la lógica de cálculo de targetDateForDisplay igual que en #50)
      // ... (chequeo de MAX_DAYS_FOR_USER_REQUEST igual que en #50)
      // ... (lógica de targetDateIdentifierForSlotFilter y timeMatch igual que en #50)
      // ... (validación de WORKING_HOURS_CHILE_NUMERIC igual que en #50)

      let calendarQueryStartUtc;
      if (targetDateForDisplay) { calendarQueryStartUtc = new Date(targetDateForDisplay.getTime());} 
      else { calendarQueryStartUtc = new Date(refDateForTargetCalc.getTime()); }
      const calendarQueryEndUtc = new Date(calendarQueryStartUtc);
      calendarQueryEndUtc.setUTCDate(calendarQueryStartUtc.getUTCDate() + DAYS_TO_QUERY_CALENDAR); 
      console.log(`🗓️ Google Calendar Query: De ${calendarQueryStartUtc.toISOString()} a ${calendarQueryEndUtc.toISOString()}`);

      let googleResponse;
      try {
        console.log("DEBUG: Intentando llamar a calendar.events.list...");
        googleResponse = await calendar.events.list({
          calendarId: 'primary', // OJO: PRUEBA CON TU ID DE CALENDARIO EXPLÍCITO SI 'primary' FALLA
          timeMin: calendarQueryStartUtc.toISOString(),
          timeMax: calendarQueryEndUtc.toISOString(),
          singleEvents: true,
          orderBy: 'startTime'
        });
        console.log("DEBUG: Llamada a calendar.events.list completada.");
      } catch (googleError) {
        console.error("❌ ERROR DIRECTO en calendar.events.list:", googleError);
        return res.status(500).json({ error: 'Error al consultar el calendario de Google.', details: googleError.message });
      }

      const busySlots = googleResponse.data.items
        .filter(e => e.status !== 'cancelled')
        .map(e => { /* ... (igual que en #50) ... */ }).filter(Boolean);
      console.log(`Found ${busySlots.length} busy slots from Google Calendar.`);
      if (busySlots.length > 0) {
        console.log("DEBUG: Contenido de busySlots (eventos UTC de Google Calendar):");
        busySlots.forEach((bs, index) => { /* ... (log de busySlots igual que en #50) ... */ });
      }

      const WORKING_HOURS_CHILE_STR = [ /* ... */ ];
      const availableSlotsOutput = [];
      const processedDaysForGenericQuery = new Set();       
      let baseIterationDateDayUtcStart;
      if (targetDateForDisplay) { baseIterationDateDayUtcStart = new Date(targetDateForDisplay); } 
      else { baseIterationDateDayUtcStart = new Date(refDateForTargetCalc); }

      console.log(`DEBUG: Iniciando bucle de ${DAYS_TO_QUERY_CALENDAR} días. Base UTC para iteración: ${baseIterationDateDayUtcStart.toISOString()}`);

      for (let i = 0; i < DAYS_TO_QUERY_CALENDAR; i++) {
        const currentDayProcessingUtcStart = new Date(baseIterationDateDayUtcStart);
        currentDayProcessingUtcStart.setUTCDate(baseIterationDateDayUtcStart.getUTCDate() + i);
        const currentDayProcessingIdentifierChile = getDayIdentifier(currentDayProcessingUtcStart, 'America/Santiago');
        console.log(`\nDEBUG: Bucle Día i=${i}. Iterando para día UTC: ${currentDayProcessingUtcStart.toISOString()} (Corresponde al día de Chile: ${currentDayProcessingIdentifierChile})`);
        if (targetDateIdentifierForSlotFilter) {
             console.log(`DEBUG: comparando con targetDateIdentifierForSlotFilter: ${targetDateIdentifierForSlotFilter}`);
        }

        for (const timeChileStr of WORKING_HOURS_CHILE_STR) {
          const [hChile, mChile] = timeChileStr.split(':').map(Number);
          let skipReason = ""; 

          if (targetHourChile !== null) { if (hChile !== targetHourChile || mChile !== targetMinuteChile) { skipReason = "Filtro de hora específica"; }
          } else if (timeOfDay && !(isAnyNextWeekIndicator && !targetDateIdentifierForSlotFilter && !isProximoWordQuery) ) { 
            if (timeOfDay === 'morning' && (hChile < 10 || hChile >= 14)) skipReason = "Filtro franja mañana";
            if (timeOfDay === 'afternoon' && (hChile < 14 || hChile > 19 || (hChile === 19 && mChile > 30))) skipReason = "Filtro franja tarde";
          }
          if (skipReason) { 
            // console.log(`  Slot ${timeChileStr} Chile DESCARTADO PREVIAMENTE por: ${skipReason}`); 
            continue; 
          }

          const slotStartUtc = convertChileTimeToUtc(currentDayProcessingUtcStart, hChile, mChile);
          const slotDayIdentifierInChile = getDayIdentifier(slotStartUtc, 'America/Santiago');
          console.log(`  SLOT CANDIDATO: ${timeChileStr} Chile. -> slotStartUtc: ${slotStartUtc.toISOString()} (Día en Chile del Slot: ${slotDayIdentifierInChile})`);

          if (isNaN(slotStartUtc.getTime())) { console.log(`    DESCARTADO: Slot UTC inválido.`); continue; }
          
          const slightlyFutureServerNowUtc = new Date(serverNowUtc.getTime() + 1 * 60 * 1000); 
          if (slotStartUtc < slightlyFutureServerNowUtc) {
            console.log(`    DESCARTADO: Slot es pasado (${slotStartUtc.toISOString()} < ${slightlyFutureServerNowUtc.toISOString()})`);
            continue;
          }

          if (targetDateIdentifierForSlotFilter) {
            if (slotDayIdentifierInChile !== targetDateIdentifierForSlotFilter) {
              console.log(`    DESCARTADO: Día del slot ${slotDayIdentifierInChile} NO es target ${targetDateIdentifierForSlotFilter}.`);
              continue; 
            }
            console.log(`    FILTRO DÍA: Día del slot ${slotDayIdentifierInChile} SÍ es target ${targetDateIdentifierForSlotFilter}.`);
          } else {
            console.log(`    FILTRO DÍA: No hay targetDateIdentifierForSlotFilter (búsqueda genérica para este slot).`);
          }

          const slotEndUtc = new Date(slotStartUtc);
          slotEndUtc.setUTCMinutes(slotEndUtc.getUTCMinutes() + 30);
          const isBusy = busySlots.some(busy => slotStartUtc.getTime() < busy.end && slotEndUtc.getTime() > busy.start);
          console.log(`    EVALUANDO: ${new Intl.DateTimeFormat('es-CL', {weekday: 'long', day: 'numeric', month: 'long',hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago'}).format(slotStartUtc)} - ¿Está ocupado? ${isBusy}`);
          
          if (!isBusy) { 
            const formattedSlot = new Intl.DateTimeFormat('es-CL', { /* ... */ }).format(slotStartUtc); // igual
            // ... (lógica de añadir a availableSlotsOutput igual que en #50)
            if (!targetDateIdentifierForSlotFilter && !targetHourChile) { /* ... */ }
            else { availableSlotsOutput.push(formattedSlot); }
            console.log(`      ✅ AÑADIDO: ${formattedSlot}`);
          } else {
            console.log(`      OCUPADO (isBusy=true).`);
          }
        } // Fin bucle WORKING_HOURS_CHILE_STR
        // ... (lógica de break del bucle i igual que en #50)
      } // Fin bucle iterationDays
      
      // ... (resto del código de construcción de reply y OpenAI igual que en Respuesta #50)
      // ... Asegúrate que esta parte (desde el log de "🔎 Slots encontrados...") esté completa.
    } // Fin if (isCalendarQuery)
    // ... (fallback a OpenAI igual)
  } catch (error) { /* ... (igual) ... */ }
}
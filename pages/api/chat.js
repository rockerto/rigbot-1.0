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
      'proxima semana', 'próxima semana', 'prixima semana', 'procsima semana', 'proxima semama', // Tus variaciones
      'proximo', 'próximo', 'priximo', 'procsimo' // Tus variaciones
    ];
    const isCalendarQuery = calendarKeywords.some(keyword => lowerMessage.includes(keyword));

    if (isCalendarQuery) {
      console.log('⏳ Detectada consulta de calendario');
      let calendar;
      try {
        console.log("DEBUG: Intentando obtener cliente de Google Calendar...");
        calendar = await getCalendarClient();
        if (!calendar || typeof calendar.events?.list !== 'function') {
            console.error("DEBUG ERROR: getCalendarClient() no devolvió un cliente de calendario válido.");
            throw new Error("Cliente de calendario no inicializado correctamente.");
        }
        console.log("DEBUG: Cliente de Google Calendar obtenido.");
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
      let isGenericNextWeekSearch = false; // Para "proxima semana" sin día específico

      const currentYearChile = parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      const currentMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10) -1; 
      const currentDayOfMonthChile = parseInt(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/Santiago' }).format(serverNowUtc), 10);
      const todayChile0000UtcTimestamp = Date.UTC(currentYearChile, currentMonthChile, currentDayOfMonthChile, 0 - CHILE_UTC_OFFSET_HOURS, 0, 0, 0);
      const refDateForTargetCalc = new Date(todayChile0000UtcTimestamp);
      const actualCurrentDayOfWeekInChile = refDateForTargetCalc.getUTCDay();
      
      const isProximoWordQuery = calendarKeywords.some(k => k.startsWith("proximo") && lowerMessage.includes(k));
      const isAnyNextWeekIndicator = calendarKeywords.some(k => k.includes("semana") && lowerMessage.includes(k));

      let specificDayKeywordIndex = -1;
      const dayKeywordsList = [ /* ... (lista de dayKeywordsList) ... */ ];
      for (const dayInfo of dayKeywordsList) { if (lowerMessage.includes(dayInfo.keyword)) { specificDayKeywordIndex = dayInfo.index; break; } }
      
      if (lowerMessage.includes('hoy')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
      } else if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + 1);
      } else if (specificDayKeywordIndex !== -1) {
        targetDateForDisplay = new Date(refDateForTargetCalc);
        let daysToAdd = specificDayKeywordIndex - actualCurrentDayOfWeekInChile;
        if (daysToAdd < 0) { daysToAdd += 7; }
        if ((isAnyNextWeekIndicator && daysToAdd < 7) || (daysToAdd === 0 && isProximoWordQuery)) { daysToAdd += 7;}
        else if (daysToAdd === 0 && !isProximoWordQuery && serverNowUtc.getUTCHours() >= (19 - CHILE_UTC_OFFSET_HOURS)) { daysToAdd += 7; }
        targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysToAdd);
      } else if (isAnyNextWeekIndicator) { 
          targetDateForDisplay = new Date(refDateForTargetCalc);
          let daysUntilNextMonday = (1 - actualCurrentDayOfWeekInChile + 7) % 7;
          if (daysUntilNextMonday === 0) daysUntilNextMonday = 7; 
          targetDateForDisplay.setUTCDate(targetDateForDisplay.getUTCDate() + daysUntilNextMonday); 
          isGenericNextWeekSearch = true; // Es una búsqueda genérica para la prox semana
      }
      
      if (targetDateForDisplay) {
        console.log(`🎯 Fecha Objetivo (para mostrar y filtrar): ${new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} (UTC: ${targetDateForDisplay.toISOString()})`);
        const futureLimitCheckDate = new Date(refDateForTargetCalc); 
        futureLimitCheckDate.setUTCDate(futureLimitCheckDate.getUTCDate() + MAX_DAYS_FOR_USER_REQUEST);
        if (targetDateForDisplay >= futureLimitCheckDate) {
            const formattedDateAsked = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay);
            let reply = `¡Entiendo que buscas para el ${formattedDateAsked}! 😊 Por ahora, mi calendario mental solo llega hasta unos ${MAX_DAYS_FOR_USER_REQUEST} días en el futuro. Para consultas más allá, por favor escribe directamente al WhatsApp 👉 +56 9 8996 7350 y mis colegas humanos te ayudarán con gusto.`;
            console.log('✅ Respuesta generada (fecha demasiado lejana):', reply);
            return res.status(200).json({ response: reply }); 
        }
      }
      
      // Si es búsqueda genérica de "próxima semana", no filtramos por un día específico de slots
      targetDateIdentifierForSlotFilter = (targetDateForDisplay && !isGenericNextWeekSearch) ? getDayIdentifier(targetDateForDisplay, 'America/Santiago') : null;
      
      if(targetDateIdentifierForSlotFilter) { console.log(`🏷️ Identificador de Fecha para Filtro de Slots (Chile YAML-MM-DD): ${targetDateIdentifierForSlotFilter}`); } 
      else if (targetDateForDisplay && isGenericNextWeekSearch) { console.log(`🏷️ Búsqueda genérica para la semana que comienza el ${getDayIdentifier(targetDateForDisplay, 'America/Santiago')}, sin filtro de día específico.`); } 
      else { console.log(`🏷️ Búsqueda genérica desde hoy, sin filtro de día específico.`); }
      
      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30|15|45))?\s*(pm|am|h|hr|hrs)?/i);
      if (timeMatch) { /* ... (lógica de hora) ... */ }
      if (!targetHourChile && !isAnyNextWeekIndicator && !isProximoWordQuery && !(targetDateForDisplay && getDayIdentifier(targetDateForDisplay, 'America/Santiago') !== getDayIdentifier(refDateForTargetCalc, 'America/Santiago'))) { 
        /* ... (lógica timeOfDay) ... */
      }
      if (targetHourChile !== null) { 
        const WORKING_HOURS_CHILE_NUMERIC = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18, 18.5, 19, 19.5];
        const requestedTimeNumeric = targetHourChile + (targetMinuteChile / 60);
        if (!WORKING_HOURS_CHILE_NUMERIC.includes(requestedTimeNumeric) || requestedTimeNumeric < 10 || requestedTimeNumeric > 19.5) {
            let reply = `¡Ojo! 👀 Parece que las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`;
            if (targetDateForDisplay) { reply = `¡Ojo! 👀 Parece que el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`; }
            reply += ` está fuera de nuestro horario de atención (10:00 a 19:30). ¿Te gustaría buscar dentro de ese rango?`;
            // AÑADIR LLAMADA A WHATSAPP AQUÍ SI SE DESEA, O DEJAR QUE OPENAI LO MANEJE
            // reply += `\n\nSi prefieres, para más ayuda, contáctanos por WhatsApp 👉 +56 9 8996 7350.`;
            console.log('✅ Respuesta generada (fuera de horario):', reply);
            return res.status(200).json({ response: reply }); // Se quitó el footer automático
        }
      }

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
          calendarId: 'primary', 
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
      
      // ***** ASEGURARSE QUE googleResponse Y googleResponse.data EXISTEN ANTES DE ACCEDER A .items *****
      const events = googleResponse && googleResponse.data && googleResponse.data.items ? googleResponse.data.items : [];
      const busySlots = events.filter(e => e.status !== 'cancelled')
        .map(e => { /* ... (igual) ... */ }).filter(Boolean);
      console.log(`Found ${busySlots.length} busy slots from Google Calendar.`);
      if (busySlots.length > 0) { console.log("DEBUG: Contenido de busySlots..."); /* ... */ }

      const WORKING_HOURS_CHILE_STR = [ /* ... */ ];
      const availableSlotsOutput = [];
      const processedDaysForGenericQuery = new Set();       
      let baseIterationDateDayUtcStart;
      if (targetDateForDisplay) { baseIterationDateDayUtcStart = new Date(targetDateForDisplay); } 
      else { baseIterationDateDayUtcStart = new Date(refDateForTargetCalc); }

      console.log(`DEBUG: Iniciando bucle de ${DAYS_TO_QUERY_CALENDAR} días. Base UTC para iteración: ${baseIterationDateDayUtcStart.toISOString()}`);
      for (let i = 0; i < DAYS_TO_QUERY_CALENDAR; i++) { /* ... (bucle interno igual que en #52/#54 con logs detallados) ... */ }
      
      if(targetDateIdentifierForSlotFilter) { /* ... */ } 
      else { console.log(`🔎 Slots encontrados en búsqueda general (próximos ${DAYS_TO_QUERY_CALENDAR} días): ${availableSlotsOutput.length}`); }
      
      let reply = '';
      // ... (Lógica de construcción de reply igual que en respuesta #52, con los textos mejorados,
      //      PERO SIN el scheduleFooterMessage al final) ...
      // ... (Asegúrate de que el reply para "no encontrado" sea amigable)
      if (targetHourChile !== null) { /* ... */ }
      else if (availableSlotsOutput.length > 0) { /* ... */ }
      else { 
          reply = '¡Pucha! 😔 Parece que no tengo horas libres';
          if (targetDateForDisplay) { reply += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`;}
          else if (isAnyNextWeekIndicator) { reply += ` para la próxima semana`; }
          if (timeOfDay === 'morning') reply += ' por la mañana'; if (timeOfDay === 'afternoon') reply += ' por la tarde';
          if (targetHourChile !== null && !targetDateForDisplay && !isAnyNextWeekIndicator) reply += ` a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`
          if (targetDateForDisplay || timeOfDay || targetHourChile || isAnyNextWeekIndicator) { reply += '.'; } 
          else { reply += ` dentro de los próximos ${DAYS_TO_QUERY_CALENDAR} días.`; }
          reply += ' ¿Te animas a que busquemos en otra fecha u horario? ¡Seguro encontramos algo! 👍';
          // Aquí NO añadimos el footer de WhatsApp, dejamos que OpenAI lo maneje si es necesario.
      }


      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });
    } 

    // --- Si no es consulta de calendario, usar OpenAI ---
    console.log('💡 Consulta normal, usando OpenAI');
    // ***** SYSTEM PROMPT AJUSTADO PARA MANEJAR LÍMITES Y DERIVACIÓN *****
    const systemPrompt = process.env.RIGBOT_PROMPT || 
`Eres Rigbot, el asistente virtual de la consulta quiropráctica Rigquiropráctico, atendido por el quiropráctico Roberto Ibacache en Copiapó, Chile.
Tu rol es entregar información clara, profesional, cálida y empática a quienes consultan por servicios quiroprácticos. Si se consulta por horarios, usa la información del calendario conectado.

CAPACIDADES DE HORARIOS:
- Cuando me preguntes por horarios, puedo revisar la disponibilidad para los próximos ${DAYS_TO_QUERY_CALENDAR} días aproximadamente, comenzando desde la fecha que me indiques (o desde hoy si no especificas).
- Si el usuario pide un día o franja específica dentro de ese rango, me enfocaré en eso.
- Si pide una hora específica y está disponible, la confirmaré con entusiasmo.
- Si una hora específica NO está disponible, informaré y puedo sugerir alternativas cercanas para ESE MISMO DÍA si las hay. Si no, simplemente diré que no hay para esa hora/día.
- Si no se encuentran horarios para los criterios dentro de mi rango de búsqueda (los próximos ${DAYS_TO_QUERY_CALENDAR} días), lo informaré claramente.
- **IMPORTANTE:** Si el usuario pregunta por fechas más allá de los ${DAYS_TO_QUERY_CALENDAR} días que puedo ver claramente (ej. "en 3 semanas", "el proximo mes"), o si la búsqueda es muy compleja, o directamente para agendar, confirmar detalles y pagar, indícale amablemente que para esos casos es mejor que escriba directamente al WhatsApp. No intentes adivinar o buscar para esas fechas lejanas tú mismo.

DERIVACIÓN A WHATSAPP (Úsala cuando sea apropiado, especialmente al final de una consulta de horarios o si no puedes ayudar más con el calendario):
"Para más detalles, confirmar tu hora, consultar por fechas más lejanas, o cualquier otra pregunta, conversemos por WhatsApp 👉 +56 9 8996 7350 ¡Mis colegas humanos te esperan para ayudarte!" (Puedes variar la frase para que suene natural y alegre).

INFO GENERAL (Solo si se pregunta directamente):
PRECIOS: 1 sesión: $40.000, Pack 2: $70.000, Pack 3: $100.000, Pack 5: $160.000, Pack 10: $300.000. Packs compartibles con pago único.
DIRECCIÓN: Centro de Salud Fleming, Van Buren 129, Copiapó. (Solo entregar si ya se ha hablado de agendar o pagar, e invitar a WhatsApp para confirmar).
QUIROPRAXIA VIDEO: Si preguntan qué es, comparte https://youtu.be/EdEZyZUDAw0 (placeholder) y explica brevemente.

TONO:
¡Siempre alegre y optimista! Cálido, empático, servicial y profesional, pero muy cercano y amigable. Evita ser robótico. Adapta tu entusiasmo al del usuario. Usa emojis con moderación para realzar el tono. 🎉😊👍👀🥳`;

    const chatResponse = await openai.chat.completions.create({ /* ... */ });
    let gptReply = chatResponse.choices[0].message.content.trim();
    return res.status(200).json({ response: gptReply });

  } catch (error) { /* ... */ }
}
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
      // ... (resto de la lógica de fechas, targetDateForDisplay, etc. igual que en respuesta #48)
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
          isGenericSearch = true; 
      }
      
      if (targetDateForDisplay) { /* ... (log 🎯 y chequeo MAX_DAYS_FOR_USER_REQUEST igual) ... */ }
      targetDateIdentifierForSlotFilter = (targetDateForDisplay && !isGenericSearch) ? getDayIdentifier(targetDateForDisplay, 'America/Santiago') : null;
      if(targetDateIdentifierForSlotFilter) { /* ... log 🏷️ ... */ } 
      else if (targetDateForDisplay && isGenericSearch) { /* ... log 🏷️ ... */ } 
      else { console.log(`🏷️ Búsqueda genérica desde hoy, sin filtro de día específico.`);}
      
      const timeMatch = lowerMessage.match(/(\d{1,2})\s*(:(00|30|15|45))?\s*(pm|am|h|hr|hrs)?/i);
      if (timeMatch) { /* ... (lógica de hora igual) ... */ }
      if (!targetHourChile && !isAnyNextWeekIndicator && !isProximoWordQuery && !(targetDateForDisplay && getDayIdentifier(targetDateForDisplay, 'America/Santiago') !== getDayIdentifier(refDateForTargetCalc, 'America/Santiago'))) { /* ... (lógica timeOfDay igual) ... */ }
      if (targetHourChile !== null) { /* ... (validación horario laboral igual) ... */ }

      let calendarQueryStartUtc;
      if (targetDateForDisplay) { calendarQueryStartUtc = new Date(targetDateForDisplay.getTime());} 
      else { calendarQueryStartUtc = new Date(refDateForTargetCalc.getTime()); }
      const calendarQueryEndUtc = new Date(calendarQueryStartUtc);
      calendarQueryEndUtc.setUTCDate(calendarQueryStartUtc.getUTCDate() + DAYS_TO_QUERY_CALENDAR); 
      console.log(`🗓️ Google Calendar Query: De ${calendarQueryStartUtc.toISOString()} a ${calendarQueryEndUtc.toISOString()}`);

      // ***** TRY...CATCH PARA LA LLAMADA A GOOGLE CALENDAR *****
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
      // ***** FIN TRY...CATCH *****

      const busySlots = googleResponse.data.items.filter(e => e.status !== 'cancelled')
        .map(e => { /* ... (igual) ... */ }).filter(Boolean);
      console.log(`Found ${busySlots.length} busy slots from Google Calendar.`);
      if (busySlots.length > 0 ) { /* ... log de busySlots ... */ }

      // ... (resto de la lógica de generación de availableSlotsOutput y construcción de reply igual que en #48)
      // ... Recuerda que aquí YA NO se añade el scheduleFooterMessage automáticamente al final de reply.
      // ... Los mensajes de respuesta que construyas aquí deben ser finales o OpenAI los complementará.
      // ... (COPIA EL RESTO DEL CÓDIGO DESDE AQUÍ HASTA EL FINAL DEL BLOQUE `if (isCalendarQuery)` DE LA RESPUESTA #48)
      const WORKING_HOURS_CHILE_STR = [ /* ... */ ]; const availableSlotsOutput = []; const processedDaysForGenericQuery = new Set(); let baseIterationDateDayUtcStart; if (targetDateForDisplay) { baseIterationDateDayUtcStart = new Date(targetDateForDisplay); } else { baseIterationDateDayUtcStart = new Date(refDateForTargetCalc); } for (let i = 0; i < DAYS_TO_QUERY_CALENDAR; i++) { const currentDayProcessingUtcStart = new Date(baseIterationDateDayUtcStart); currentDayProcessingUtcStart.setUTCDate(baseIterationDateDayUtcStart.getUTCDate() + i); for (const timeChileStr of WORKING_HOURS_CHILE_STR) { const [hChile, mChile] = timeChileStr.split(':').map(Number); if (targetHourChile !== null) { if (hChile !== targetHourChile || mChile !== targetMinuteChile) continue; } else if (timeOfDay && !(isAnyNextWeekIndicator && !targetDateIdentifierForSlotFilter && !isProximoWordQuery) ) { if (timeOfDay === 'morning' && (hChile < 10 || hChile >= 14)) continue; if (timeOfDay === 'afternoon' && (hChile < 14 || hChile > 19 || (hChile === 19 && mChile > 30))) continue; } const slotStartUtc = convertChileTimeToUtc(currentDayProcessingUtcStart, hChile, mChile); if (isNaN(slotStartUtc.getTime())) { console.error("Slot UTC inválido:", currentDayProcessingUtcStart, hChile, mChile); continue; } const slightlyFutureServerNowUtc = new Date(serverNowUtc.getTime() + 5 * 60 * 1000); if (slotStartUtc < slightlyFutureServerNowUtc) continue; const slotDayIdentifierInChile = getDayIdentifier(slotStartUtc, 'America/Santiago'); if (targetDateIdentifierForSlotFilter) { if (slotDayIdentifierInChile !== targetDateIdentifierForSlotFilter) { continue; } } const slotEndUtc = new Date(slotStartUtc); slotEndUtc.setUTCMinutes(slotEndUtc.getUTCMinutes() + 30); const isBusy = busySlots.some(busy => slotStartUtc.getTime() < busy.end && slotEndUtc.getTime() > busy.start); if (!isBusy) { const formattedSlot = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' }).format(slotStartUtc); if (!targetDateIdentifierForSlotFilter && !targetHourChile) { if (availableSlotsOutput.length < 10) { if (!processedDaysForGenericQuery.has(slotDayIdentifierInChile) || availableSlotsOutput.length < 2) { availableSlotsOutput.push(formattedSlot); processedDaysForGenericQuery.add(slotDayIdentifierInChile); } else if (Array.from(processedDaysForGenericQuery).length < 3 && availableSlotsOutput.filter(s => s.startsWith(new Intl.DateTimeFormat('es-CL', {weekday: 'long', timeZone: 'America/Santiago'}).format(slotStartUtc))).length < 2) { availableSlotsOutput.push(formattedSlot); } } } else { availableSlotsOutput.push(formattedSlot); } } } if (targetDateIdentifierForSlotFilter && getDayIdentifier(currentDayProcessingUtcStart, 'America/Santiago') === targetDateIdentifierForSlotFilter) { if (targetHourChile !== null || availableSlotsOutput.length >= MAX_SUGGESTIONS ) break; } if (availableSlotsOutput.length >= MAX_SUGGESTIONS && !targetDateIdentifierForSlotFilter && !targetHourChile && processedDaysForGenericQuery.size >=2) break; } if(targetDateIdentifierForSlotFilter) { console.log(`🔎 Slots encontrados para el día de Chile ${targetDateIdentifierForSlotFilter}: ${availableSlotsOutput.length}`); } else { console.log(`🔎 Slots encontrados en búsqueda general (próximos ${DAYS_TO_QUERY_CALENDAR} días): ${availableSlotsOutput.length}`); } let reply = ''; if (targetHourChile !== null) { if (availableSlotsOutput.length > 0) { reply = `¡Excelente! 🎉 Justo el ${availableSlotsOutput[0]} está libre para ti. ¡Qué buena suerte! Para asegurar tu cita, contáctanos directamente por WhatsApp al 👉 +56 9 8996 7350 y la reservamos. 😉`; } else { let specificTimeQuery = ""; if(targetDateForDisplay) specificTimeQuery += `${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)} `; specificTimeQuery += `a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`; reply = `¡Uy! Justo ${specificTimeQuery} no me quedan espacios. 😕 ¿Te gustaría que revise otro horario o quizás otro día? Si prefieres, puedes escribirnos a WhatsApp al 👉 +56 9 8996 7350.`; } } else if (availableSlotsOutput.length > 0) { let intro = `¡Buenas noticias! 🎉 Encontré estas horitas disponibles`; if (targetDateForDisplay) { intro += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`; } else if (isAnyNextWeekIndicator) { intro += ` para la próxima semana`; } else { intro += ` en los próximos días`; } if (timeOfDay === 'morning') intro += ' por la mañana'; if (timeOfDay === 'afternoon') intro += ' por la tarde'; intro += '. ¡A ver si alguna te acomoda! 🥳:'; let finalSuggestions = []; if (!targetDateIdentifierForSlotFilter && !targetHourChile) { const slotsByDay = {}; for (const slot of availableSlotsOutput) { const dayName = slot.split(',')[0]; if (!slotsByDay[dayName]) slotsByDay[dayName] = []; if (slotsByDay[dayName].length < 2) { slotsByDay[dayName].push(slot); } } let count = 0; for (const day in slotsByDay) { for(const slot of slotsByDay[day]){ if(count < MAX_SUGGESTIONS){ finalSuggestions.push(slot); count++; } else { break; } } if (count >= MAX_SUGGESTIONS) break; } } else { finalSuggestions = availableSlotsOutput.slice(0, MAX_SUGGESTIONS); } reply = `${intro}\n- ${finalSuggestions.join('\n- ')}`; if (availableSlotsOutput.length > finalSuggestions.length && finalSuggestions.length > 0) { const remaining = availableSlotsOutput.length - finalSuggestions.length; if (remaining > 0) { reply += `\n\n(Y ${remaining} más... ¡para que tengas de dónde elegir! 😉)`; } } reply += `\n\nPara reservar alguna o si buscas otra opción, escríbenos por WhatsApp al 👉 +56 9 8996 7350.`; } else { reply = '¡Pucha! 😔 Parece que no tengo horas libres'; if (targetDateForDisplay) { reply += ` para el ${new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Santiago' }).format(targetDateForDisplay)}`; } else if (isAnyNextWeekIndicator) { reply += ` para la próxima semana`; } if (timeOfDay === 'morning') reply += ' por la mañana'; if (timeOfDay === 'afternoon') reply += ' por la tarde'; if (targetHourChile !== null && !targetDateForDisplay && !isAnyNextWeekIndicator) reply += ` a las ${targetHourChile.toString().padStart(2,'0')}:${targetMinuteChile.toString().padStart(2,'0')}`
        if (targetDateForDisplay || timeOfDay || targetHourChile || isAnyNextWeekIndicator) { reply += '.'; } else { reply += ` dentro de los próximos ${DAYS_TO_QUERY_CALENDAR} días.`; } reply += ' ¿Te animas a que busquemos en otra fecha u horario? ¡Seguro encontramos algo! 👍 Si no, para una atención más directa, escríbenos por WhatsApp al 👉 +56 9 8996 7350.'; }

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
- **IMPORTANTE:** Si el usuario pregunta por fechas más allá de los ${DAYS_TO_QUERY_CALENDAR} días que puedo ver claramente (ej. "en 3 semanas", "el proximo mes"), o si la búsqueda es muy compleja, o para agendar y pagar, indícale amablemente que para esos casos es mejor que escriba directamente al WhatsApp.

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

    const chatResponse = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ]
    });

    let gptReply = chatResponse.choices[0].message.content.trim();
    
    // Considerar añadir el CTA de WhatsApp si la respuesta de OpenAI es muy corta o no lo incluye
    // y la consulta original era sobre horarios (isCalendarQuery era true pero no se pudo resolver)
    // Esto es más complejo de determinar aquí. Por ahora, confiamos en el prompt.

    return res.status(200).json({ response: gptReply });

  } catch (error) {
    console.error('❌ Error en Rigbot:', error);
    console.error(error.stack); 
    return res.status(500).json({ error: 'Ocurrió un error en Rigbot. ' + error.message });
  }
}
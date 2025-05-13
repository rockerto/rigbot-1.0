Primero, instala las dependencias:

Bash

npm install date-fns date-fns-tz
# o si usas yarn:
yarn add date-fns date-fns-tz
Luego, reemplaza el bloque if dentro de tu try con esto:

JavaScript

    // --- INICIO BLOQUE MODIFICADO ---
    // Detectar si la pregunta es de horarios (mantenemos la detección simple por ahora)
    const lowerMessage = message.toLowerCase();
    const isCalendarQuery = lowerMessage.includes('hora') || lowerMessage.includes('turno') || lowerMessage.includes('disponibilidad') || lowerMessage.includes('agenda') || lowerMessage.includes('cuando');

    if (isCalendarQuery) {
      console.log('⏳ Detectada consulta de calendario');

      // --- Manejo de Fechas y Zona Horaria con date-fns-tz ---
      const { zonedTimeToUtc, utcToZonedTime, format, startOfDay, endOfDay, addDays, getDay, isEqual, addMinutes } = await import('date-fns-tz');
      const { es } = await import('date-fns/locale'); // Importar locale español
      const timeZone = 'America/Santiago'; // Zona horaria de Chile

      // --- Extracción básica de Día y Hora de la Petición ---
      let targetDate = null;
      let targetTimeRange = { start: null, end: null }; // null significa cualquier hora
      const today = utcToZonedTime(new Date(), timeZone); // Hora actual en Chile

      // Mapeo simple días de la semana (0=Domingo, 1=Lunes...)
      const dayKeywords = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6 };
      let foundTargetDay = -1;

      for (const [keyword, dayIndex] of Object.entries(dayKeywords)) {
        if (lowerMessage.includes(keyword)) {
          foundTargetDay = dayIndex;
          break;
        }
      }

      // Calcular la fecha objetivo si se mencionó un día
      if (foundTargetDay !== -1) {
        let daysToAdd = foundTargetDay - getDay(today);
        if (daysToAdd < 0) daysToAdd += 7; // Si ya pasó ese día esta semana, buscar en la siguiente
        targetDate = startOfDay(addDays(today, daysToAdd)); // Fecha objetivo al inicio del día
        console.log(`🗓️ Día objetivo detectado: ${format(targetDate, 'yyyy-MM-dd', { timeZone })}`);
      } else if (lowerMessage.includes('hoy')) {
         targetDate = startOfDay(today);
         console.log(`🗓️ Día objetivo detectado: hoy (${format(targetDate, 'yyyy-MM-dd', { timeZone })})`);
      } else if (lowerMessage.includes('mañana')) {
         targetDate = startOfDay(addDays(today, 1));
          console.log(`🗓️ Día objetivo detectado: mañana (${format(targetDate, 'yyyy-MM-dd', { timeZone })})`);
      }
      // Si no se especifica día, buscará en los próximos 7 días (o podríamos pedir aclaración)

      // Identificar franja horaria (muy básico)
      if (lowerMessage.includes('mañana')) {
        targetTimeRange = { start: 9, end: 13 }; // Ej: 9 AM a 1 PM
        console.log('⏰ Franja horaria: Mañana');
      } else if (lowerMessage.includes('tarde')) {
        targetTimeRange = { start: 14, end: 20 }; // Ej: 2 PM a 8 PM (19:30 es la última hora)
        console.log('⏰ Franja horaria: Tarde');
      }

      // --- Lógica de Google Calendar (adaptada) ---
      const calendar = await getCalendarClient();
      const queryStartTime = zonedTimeToUtc(startOfDay(today), timeZone); // Desde hoy
      const queryEndTime = zonedTimeToUtc(endOfDay(addDays(today, 7)), timeZone); // Hasta 7 días en el futuro

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: queryStartTime.toISOString(),
        timeMax: queryEndTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items
        .filter(e => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime) // Filtrar cancelados y eventos sin hora
        .map(e => ({
          // Convertir horas de Google (con timezone) a objetos Date (internamente UTC)
          start: new Date(e.start.dateTime),
          end: new Date(e.end.dateTime)
        }));

      // Horas de trabajo (considera si necesitas diferentes por día)
      const WORKING_HOURS_SLOTS = [
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];

      const availableSlots = [];
      const nowUtc = new Date(); // Hora actual UTC para comparación

      // Iterar sobre los próximos 7 días desde hoy
      for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
        const currentDay = startOfDay(addDays(today, dayOffset));

        // Si se especificó un día, solo procesar ese día
        if (targetDate && !isEqual(currentDay, targetDate)) {
          continue; // Saltar días que no son el objetivo
        }

        // Iterar sobre las horas de trabajo
        for (const time of WORKING_HOURS_SLOTS) {
          const [hourStr, minuteStr] = time.split(':');
          const hour = parseInt(hourStr, 10);

          // Filtrar por franja horaria si se especificó
          if (targetTimeRange.start !== null && (hour < targetTimeRange.start || hour >= targetTimeRange.end)) {
            continue; // Saltar horas fuera de la franja solicitada
          }

          // Crear el inicio y fin del slot en la zona horaria correcta (Chile) y convertir a UTC para comparar
          const slotStartLocalStr = `${format(currentDay, 'yyyy-MM-dd')}T${time}:00`;
          const slotStartUtc = zonedTimeToUtc(slotStartLocalStr, timeZone);
          const slotEndUtc = addMinutes(slotStartUtc, 30); // Slots de 30 minutos

          // Verificar si el slot está ocupado y si es futuro
          const isBusy = events.some(event => slotStartUtc < event.end && slotEndUtc > event.start);
          const isFuture = slotStartUtc > nowUtc;

          if (!isBusy && isFuture) {
            // Formatear la salida en hora local de Chile
            const zonedSlotStart = utcToZonedTime(slotStartUtc, timeZone);
            availableSlots.push({
                date: zonedSlotStart, // Guardar objeto Date para posible ordenamiento
                formatted: format(zonedSlotStart, "EEEE d 'de' MMMM, HH:mm", { locale: es, timeZone })
            });
          }
        }
      }

      // --- Formatear Respuesta ---
      let reply = '';
      const MAX_SUGGESTIONS = 5; // Limitar número de sugerencias

      if (availableSlots.length > 0) {
        // Ordenar slots por fecha (ya deberían estarlo, pero por si acaso)
        availableSlots.sort((a, b) => a.date - b.date);

        const suggestions = availableSlots.slice(0, MAX_SUGGESTIONS).map(slot => `- ${slot.formatted}`);
        let intro = `📅 Encontré estas ${availableSlots.length > 1 ? 'horas disponibles' : 'hora disponible'}`;
        if (targetDate) {
            intro += ` para el ${format(targetDate, "EEEE d 'de' MMMM", { locale: es, timeZone })}`;
        }
        if (targetTimeRange.start !== null) {
             intro += lowerMessage.includes('mañana') ? ' por la mañana' : lowerMessage.includes('tarde') ? ' por la tarde' : '';
        }
        intro += ':';

        reply = `${intro}\n${suggestions.join('\n')}`;

        if (availableSlots.length > MAX_SUGGESTIONS) {
          reply += `\n\n(Y algunas más disponibles...)`;
        }
      } else {
        reply = `Lo siento, no encontré horas disponibles`;
         if (targetDate) {
            reply += ` para el ${format(targetDate, "EEEE d 'de' MMMM", { locale: es, timeZone })}`;
        }
        if (targetTimeRange.start !== null) {
             reply += lowerMessage.includes('mañana') ? ' por la mañana' : lowerMessage.includes('tarde') ? ' por la tarde' : '';
        }
        reply += `. ¿Te gustaría revisar otro día u horario?`;
      }

      console.log('✅ Respuesta generada:', reply);
      return res.status(200).json({ response: reply });

    } // --- FIN DEL BLOQUE if (isCalendarQuery) ---
    // --- FIN BLOQUE MODIFICADO ---

    // Si no es consulta de calendario, usar OpenAI (código sin cambios)
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
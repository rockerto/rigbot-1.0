// pages/api/chat.js

import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';
// IMPORTS ESTÁTICOS PARA DATE-FNS:
import { zonedTimeToUtc, utcToZonedTime, format, startOfDay, endOfDay, addDays, getDay, isEqual, addMinutes } from 'date-fns-tz';
import { es } from 'date-fns/locale';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

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

      // Las funciones de date-fns-tz y 'es' locale ya están disponibles globalmente en este módulo
      // gracias a los imports estáticos de arriba.
      const timeZone = 'America/Santiago'; // Zona horaria de Chile

      let targetDate = null;
      let targetTimeRange = { start: null, end: null };
      const today = utcToZonedTime(new Date(), timeZone);

      const dayKeywords = { 'domingo': 0, 'lunes': 1, 'martes': 2, 'miercoles': 3, 'miércoles': 3, 'jueves': 4, 'viernes': 5, 'sabado': 6, 'sábado': 6 };
      let foundTargetDay = -1;

      for (const [keyword, dayIndex] of Object.entries(dayKeywords)) {
        if (lowerMessage.includes(keyword)) {
          foundTargetDay = dayIndex;
          break;
        }
      }

      if (foundTargetDay !== -1) {
        let daysToAdd = foundTargetDay - getDay(today);
        if (daysToAdd < 0) daysToAdd += 7;
        targetDate = startOfDay(addDays(today, daysToAdd));
        console.log(`🗓️ Día objetivo detectado: ${format(targetDate, 'yyyy-MM-dd', { timeZone })}`);
      } else if (lowerMessage.includes('hoy')) {
         targetDate = startOfDay(today);
         console.log(`🗓️ Día objetivo detectado: hoy (${format(targetDate, 'yyyy-MM-dd', { timeZone })})`);
      } else if (lowerMessage.includes('mañana')) {
         targetDate = startOfDay(addDays(today, 1));
         console.log(`🗓️ Día objetivo detectado: mañana (${format(targetDate, 'yyyy-MM-dd', { timeZone })})`);
      }

      if (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) { // Evitar "pasado mañana"
        targetTimeRange = { start: 9, end: 13 };
        console.log('⏰ Franja horaria: Mañana');
      } else if (lowerMessage.includes('tarde')) {
        targetTimeRange = { start: 14, end: 20 };
        console.log('⏰ Franja horaria: Tarde');
      }

      const calendar = await getCalendarClient();
      const queryStartTime = zonedTimeToUtc(startOfDay(today), timeZone);
      const queryEndTime = zonedTimeToUtc(endOfDay(addDays(today, 7)), timeZone);

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: queryStartTime.toISOString(),
        timeMax: queryEndTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items
        .filter(e => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime)
        .map(e => ({
          start: new Date(e.start.dateTime),
          end: new Date(e.end.dateTime)
        }));

      const WORKING_HOURS_SLOTS = [
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];

      const availableSlots = [];
      const nowUtc = new Date();

      for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
        const currentDay = startOfDay(addDays(today, dayOffset));

        if (targetDate && !isEqual(currentDay, targetDate)) {
          continue;
        }

        for (const time of WORKING_HOURS_SLOTS) {
          const [hourStr, minuteStr] = time.split(':');
          const hour = parseInt(hourStr, 10);

          if (targetTimeRange.start !== null && (hour < targetTimeRange.start || hour >= targetTimeRange.end)) {
            continue;
          }

          const slotStartLocalStr = `${format(currentDay, 'yyyy-MM-dd')}T${time}:00`;
          const slotStartUtc = zonedTimeToUtc(slotStartLocalStr, timeZone);
          const slotEndUtc = addMinutes(slotStartUtc, 30);

          const isBusy = events.some(event => slotStartUtc < event.end && slotEndUtc > event.start);
          const isFuture = slotStartUtc > nowUtc;

          if (!isBusy && isFuture) {
            const zonedSlotStart = utcToZonedTime(slotStartUtc, timeZone);
            availableSlots.push({
                date: zonedSlotStart,
                formatted: format(zonedSlotStart, "EEEE d 'de' MMMM, HH:mm", { locale: es, timeZone })
            });
          }
        }
      }

      let reply = '';
      const MAX_SUGGESTIONS = 5;

      if (availableSlots.length > 0) {
        availableSlots.sort((a, b) => a.date.getTime() - b.date.getTime()); // Asegurar orden cronológico
        const suggestions = availableSlots.slice(0, MAX_SUGGESTIONS).map(slot => `- ${slot.formatted}`);
        let intro = `📅 Encontré ${availableSlots.length === 1 ? 'esta hora disponible' : 'estas horas disponibles'}`;
        if (targetDate) {
            intro += ` para el ${format(targetDate, "EEEE d 'de' MMMM", { locale: es, timeZone })}`;
        }
        if (targetTimeRange.start !== null) {
             intro += (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) ? ' por la mañana' : lowerMessage.includes('tarde') ? ' por la tarde' : '';
        }
        intro += ':';
        reply = `${intro}\n${suggestions.join('\n')}`;
        if (availableSlots.length > MAX_SUGGESTIONS) {
          reply += `\n\n(Y ${availableSlots.length - MAX_SUGGESTIONS} más disponibles...)`;
        }
      } else {
        reply = `Lo siento, no encontré horas disponibles`;
         if (targetDate) {
            reply += ` para el ${format(targetDate, "EEEE d 'de' MMMM", { locale: es, timeZone })}`;
        }
        if (targetTimeRange.start !== null) {
             reply += (lowerMessage.includes('mañana') && !lowerMessage.includes('pasado mañana')) ? ' por la mañana' : lowerMessage.includes('tarde') ? ' por la tarde' : '';
        }
        reply += `. ¿Te gustaría revisar otro día u horario?`;
      }

      console.log('✅ Respuesta generada:', reply);
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
    return res.status(500).json({ error: 'Ocurrió un error en Rigbot.' });
  }
}
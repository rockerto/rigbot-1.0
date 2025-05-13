import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

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
      const calendar = await getCalendarClient();

      const now = new Date();
      const startTime = new Date(now);
      const endTime = new Date(now);
      endTime.setDate(endTime.getDate() + 7);

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const busySlots = response.data.items.map(e => {
        if (e.start?.dateTime && e.end?.dateTime) {
          return {
            start: new Date(e.start.dateTime).getTime(),
            end: new Date(e.end.dateTime).getTime()
          };
        } else if (e.start?.date && e.end?.date) {
          // Evento de día completo
          return {
            start: new Date(e.start.date).getTime(),
            end: new Date(e.end.date).getTime() - 1 // para que no bloquee el día siguiente
          };
        }
      }).filter(Boolean);

      const WORKING_HOURS = [
        '10:00', '10:30', '11:00', '11:30',
        '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30',
        '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];

      const availableSlots = [];
      for (let i = 0; i <= 7; i++) {
        const day = new Date(now);
        day.setDate(day.getDate() + i);
        day.setHours(0, 0, 0, 0);

        WORKING_HOURS.forEach(time => {
          const [hours, minutes] = time.split(':');
          const slotStart = new Date(day);
          slotStart.setHours(parseInt(hours), parseInt(minutes), 0, 0);

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + 30);

          if (slotStart < new Date()) return;

          const isBusy = busySlots.some(busy => slotStart.getTime() < busy.end && slotEnd.getTime() > busy.start);

          if (!isBusy) {
            availableSlots.push(new Intl.DateTimeFormat('es-CL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit'
            }).format(slotStart));
          }
        });
      }

      let reply = availableSlots.length
        ? `📅 Estas son algunas horas disponibles:
- ${availableSlots.slice(0, 5).join('\n- ')}${availableSlots.length > 5 ? '\n\n(Y algunas más...)' : ''}`
        : 'No se encontraron horas disponibles esta semana.';

      return res.status(200).json({ response: reply });
    }

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

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

    // Detectar si la pregunta es de horarios
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('hora') || lowerMessage.includes('turno') || lowerMessage.includes('disponibilidad')) {
      console.log('⏳ Detectada consulta de calendario');
      const calendar = await getCalendarClient();

      const startTime = new Date();
      const endTime = new Date();
      endTime.setDate(endTime.getDate() + 7);

      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items
        .filter(e => e.start.dateTime && e.end.dateTime)
        .map(e => ({
          start: new Date(e.start.dateTime),
          end: new Date(e.end.dateTime)
        }));

      const WORKING_HOURS = [
        '10:00', '10:30', '11:00', '11:30',
        '12:00', '12:30', '13:00', '13:30',
        '14:00', '14:30', '15:00', '15:30',
        '16:00', '16:30', '17:00', '17:30',
        '18:00', '18:30', '19:00', '19:30'
      ];

      const slots = [];
      for (let day = 0; day <= 7; day++) {
        const date = new Date();
        date.setDate(date.getDate() + day);
        const dateStr = date.toISOString().split('T')[0];
        for (const time of WORKING_HOURS) {
          const [hour, minute] = time.split(':');
          const slotStart = new Date(dateStr + 'T' + time + ':00');
          const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
          const busy = events.some(event => slotStart < event.end && slotEnd > event.start);
          if (!busy && slotStart > new Date()) {
            slots.push(slotStart.toLocaleString('es-CL', {
              hour: '2-digit',
              minute: '2-digit',
              weekday: 'long',
              day: 'numeric',
              month: 'long'
            }));
          }
        }
      }

      const reply = slots.length > 0 
        ? `📅 Las franjas libres disponibles son:\n- ${slots.join('\n- ')}`
        : 'No se encontraron franjas libres en los próximos 7 días.';

      return res.status(200).json({ response: reply });
    }

    // Si no es de calendario, responder con GPT normal
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

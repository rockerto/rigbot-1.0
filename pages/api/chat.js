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

      const slots = response.data.items
        .filter(e => e.start.dateTime && e.end.dateTime)
        .map(e => new Date(e.start.dateTime).toLocaleString('es-CL', { hour: '2-digit', minute: '2-digit', weekday: 'long', day: 'numeric', month: 'long' }));

      const reply = slots.length > 0 
        ? `📅 Los horarios disponibles son:
- ${slots.join('\n- ')}`
        : 'No se encontraron horas disponibles esta semana.';

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

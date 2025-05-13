import { getCalendarClient } from '@/lib/google';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o'; // GPT-4 Turbo mini

// Configuración de horarios de atención (hora local America/Santiago)
const BUSINESS_START = 10; // 10:00
const BUSINESS_END = 20;   // 20:00
const SLOT_MINUTES = 30;
const TIMEZONE = 'America/Santiago';

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
    const text = message.toLowerCase();

    // Consulta de disponibilidad de calendario
    if (text.includes('hora') || text.includes('turno') || text.includes('disponibilidad')) {
      console.log('⏳ Detectada consulta de calendario');
      const calendar = await getCalendarClient();

      // Rango de consulta: hoy a +7 días
      const now = new Date();
      const startRange = new Date(now);
      startRange.setHours(0, 0, 0, 0);
      const endRange = new Date(now);
      endRange.setDate(endRange.getDate() + 7);
      endRange.setHours(23, 59, 59, 999);

      // Obtener eventos ocupados
      const eventsRes = await calendar.events.list({
        calendarId: 'primary',
        timeMin: startRange.toISOString(),
        timeMax: endRange.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });
      const busy = eventsRes.data.items.map(e => ({
        start: new Date(e.start.dateTime || e.start.date),
        end: new Date(e.end.dateTime || e.end.date)
      }));

      // Generar franjas de 30 min libres en horario de atención
      const freeSlots = [];
      for (let d = new Date(startRange); d <= endRange; d.setDate(d.getDate() + 1)) {
        for (let h = BUSINESS_START; h < BUSINESS_END; h += SLOT_MINUTES / 60) {
          const slotStart = new Date(d);
          slotStart.setHours(Math.floor(h), (h % 1) * 60, 0, 0);
          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_MINUTES);
          // Solo dentro del rango overall
          if (slotEnd < startRange || slotStart > endRange) continue;
          // Verificar cruce con eventos ocupados
          const isBusy = busy.some(ev => ev.start < slotEnd && ev.end > slotStart);
          if (!isBusy) freeSlots.push(slotStart);
        }
      }

      // Formatear respuesta
      const reply = freeSlots.length
        ? '📅 Horarios disponibles:\n' + freeSlots.map(dt => `- ${dt.toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE })}`).join('\n')
        : 'No se encontraron horas disponibles en los próximos 7 días.';

      return res.status(200).json({ response: reply });
    }

    // Consulta normal con GPT
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
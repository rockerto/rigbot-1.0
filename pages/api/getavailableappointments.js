import { getCalendarClient } from '@/lib/google';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { start_date, end_date } = req.body;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Faltan start_date o end_date' });
  }

  try {
    const calendar = await getCalendarClient();
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(start_date).toISOString(),
      timeMax: new Date(end_date).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const busySlots = response.data.items.map((event) => ({
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
    }));

    return res.status(200).json({ busy: busySlots });
  } catch (error) {
    console.error('Error consultando Google Calendar:', error);
    return res.status(500).json({ error: 'Error consultando Google Calendar' });
  }
}

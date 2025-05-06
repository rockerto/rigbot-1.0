import { getCalendarClient } from '../../lib/google';
import { getDateRangeFromQuery } from '../../lib/utils';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { start, end } = getDateRangeFromQuery(req.query);
    const calendar = await getCalendarClient();

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const appointments = response.data.items.map(event => ({
      start: event.start.dateTime,
      end: event.end.dateTime,
    }));

    res.status(200).json({ appointments });
  } catch (error) {
    console.error('Error obteniendo disponibilidad:', error);
    res.status(500).json({ error: 'Error consultando Google Calendar' });
  }
}

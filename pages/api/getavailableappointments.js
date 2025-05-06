import { getCalendarClient } from '../../lib/google';

const START_HOUR = 10;
const END_HOUR = 20;
const INTERVAL_MINUTES = 30;

function generateTimeBlocks(date) {
  const blocks = [];
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    for (let minute = 0; minute < 60; minute += INTERVAL_MINUTES) {
      const start = new Date(year, month, day, hour, minute);
      const end = new Date(start.getTime() + INTERVAL_MINUTES * 60000);
      blocks.push({ start, end });
    }
  }

  return blocks;
}

function isOverlapping(block, events) {
  return events.some(event => {
    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end.dateTime);
    return (
      block.start < eventEnd &&
      block.end > eventStart
    );
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'Faltan start_date o end_date' });
    }

    const calendar = await getCalendarClient();
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items;
    const day = new Date(start);
    const blocks = generateTimeBlocks(day);

    const availableBlocks = blocks.filter(block => !isOverlapping(block, events));

    res.status(200).json({
      appointments: availableBlocks.map(b => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
      })),
    });
  } catch (error) {
    console.error('Error obteniendo disponibilidad:', error);
    res.status(500).json({ error: 'Error consultando Google Calendar' });
  }
}

// pages/api/getavailableappointments.js (Rigbot 1.0)

import { google } from 'googleapis';
import { authenticate } from '@/lib/google';
import { getTimeSlots } from '@/lib/utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { start_date, end_date } = req.body;

  if (!start_date || !end_date) {
    return res.status(400).json({ message: 'Missing date range' });
  }

  try {
    const auth = await authenticate();
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date(start_date).toISOString(),
      timeMax: new Date(end_date).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const existingAppointments = response.data.items.map(event => ({
      date: event.start.dateTime?.split('T')[0],
      time: event.start.dateTime?.split('T')[1]?.substring(0, 5),
    }));

    const availableAppointments = getTimeSlots(start_date, end_date, existingAppointments);

    res.status(200).json({ success: true, availableAppointments });
  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

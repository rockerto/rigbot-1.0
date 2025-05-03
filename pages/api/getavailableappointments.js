import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { start_date, end_date } = req.body;

  try {
    const credentials = JSON.parse(process.env.GOOGLE_CLIENT_SECRET_JSON);
    const token = JSON.parse(process.env.GOOGLE_TOKEN_JSON);

    const auth = new google.auth.OAuth2(
      credentials.web.client_id,
      credentials.web.client_secret,
      credentials.web.redirect_uris[0]
    );

    auth.setCredentials(token);
    const calendar = google.calendar({ version: "v3", auth });

    const start = new Date(start_date);
    const end = new Date(end_date);
    end.setDate(end.getDate() + 1);

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        timeZone: "America/Santiago",
        items: [{ id: "primary" }],
      },
    });

    const busyTimes = response.data.calendars["primary"].busy || [];

    const appointmentTimes = [
      "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
      "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"
    ];

    const availableAppointments = [];

    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];

      for (const time of appointmentTimes) {
        const [hour, minute] = time.split(":");
        const startSlot = new Date(d);
        startSlot.setHours(parseInt(hour), parseInt(minute), 0, 0);
        const endSlot = new Date(startSlot);
        endSlot.setMinutes(endSlot.getMinutes() + 30);

        const overlaps = busyTimes.some(event =>
          new Date(event.start) < endSlot && new Date(event.end) > startSlot
        );

        if (!overlaps) {
          availableAppointments.push({ date: dateStr, time });
        }
      }
    }

    return res.status(200).json({ success: true, availableAppointments });
  } catch (error) {
    console.error("Error consultando Google Calendar:", error);
    return res.status(500).json({ error: "Error consultando Google Calendar" });
  }
}

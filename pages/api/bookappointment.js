import { google } from "googleapis";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { date, time, patient, weekday } = req.body;

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

    const startDateTime = new Date(`${date}T${time}:00-04:00`);
    const endDateTime = new Date(startDateTime);
    endDateTime.setMinutes(startDateTime.getMinutes() + 30);

    // Validación: fecha y día coinciden
    if (weekday) {
      const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const diaReal = dias[startDateTime.getDay()];
      if (diaReal.toLowerCase() !== weekday.toLowerCase()) {
        return res.status(400).json({
          error: `La fecha proporcionada (${date}) cae día ${diaReal}, no ${weekday}.`,
          suggestion: `¿Querías decir ${diaReal} ${date}?`
        });
      }
    }

    // Validación: ¿ya hay un evento en ese horario?
    const conflictCheck = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDateTime.toISOString(),
        timeMax: endDateTime.toISOString(),
        timeZone: "America/Santiago",
        items: [{ id: "primary" }]
      }
    });

    const conflicts = conflictCheck.data.calendars["primary"].busy;
    if (conflicts.length > 0) {
      return res.status(409).json({
        error: "La hora ya está ocupada",
        detail: `Ya hay un evento entre ${time} y ${endDateTime.toLocaleTimeString()}`
      });
    }

    // Crear evento
    const event = {
      summary: `Sesión Quiropráctica - ${patient.name}`,
      description: `RUT: ${patient.rut}\nTel: ${patient.phone}\nCorreo: ${patient.email}`,
      start: { dateTime: startDateTime.toISOString(), timeZone: "America/Santiago" },
      end: { dateTime: endDateTime.toISOString(), timeZone: "America/Santiago" },
      attendees: [{ email: patient.email }]
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event
    });

    return res.status(200).json({ success: true, event: response.data });

  } catch (error) {
    console.error("Error creando evento en Google Calendar:", error);
    return res.status(500).json({ error: "No se pudo agendar la hora" });
  }
}

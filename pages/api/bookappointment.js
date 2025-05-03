// pages/api/bookappointment.js (Rigbot 1.0)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Método no permitido' });
  }

  try {
    const { name, rut, email, phone, requestedDate, requestedTime } = req.body;

    if (!requestedDate || !requestedTime) {
      return res.status(400).json({ message: 'Fecha y hora requeridas' });
    }

    // Respuesta simulada: NO se agenda la hora, solo se confirma la recepción de datos
    const confirmationMessage = `Recibimos tu solicitud para el día ${requestedDate} a las ${requestedTime}. Un humano del equipo te contactará pronto para confirmar la cita.`;

    // Opcional: aquí podrías enviar un email, guardar en Google Sheets, o mandar alerta por webhook

    return res.status(200).json({
      success: true,
      message: confirmationMessage,
      dataReceived: { name, rut, email, phone, requestedDate, requestedTime }
    });
  } catch (error) {
    console.error('Error en bookappointment 1.0:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
}

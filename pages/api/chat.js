import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = "asst_xLjjNmtyUT5eu3YzjHZRBCdl"; // <---- ⚠️ REEMPLAZA por tu ID real

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Falta el mensaje del usuario" });
  }

  try {
    // 1️⃣ Crear thread temporal
    const thread = await openai.beta.threads.create();

    // 2️⃣ Enviar mensaje del usuario al thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: message,
    });

    // 3️⃣ Ejecutar el Assistant oficial
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    // 4️⃣ Esperar a que finalice
    let status = "queued";
    while (status !== "completed") {
      const currentRun = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );
      status = currentRun.status;
      if (status === "completed") break;
      if (status === "failed")
        throw new Error("La ejecución del assistant falló");
      await new Promise((resolve) => setTimeout(resolve, 1000)); // espera 1s
    }

    // 5️⃣ Obtener respuesta
    const messages = await openai.beta.threads.messages.list(thread.id);
    const response = messages.data
      .filter((m) => m.role === "assistant")
      .map((m) => m.content[0]?.text?.value)
      .filter(Boolean)
      .join("\n");

    return res.status(200).json({ response });
  } catch (error) {
    console.error("❌ Error al hablar con Assistant oficial:", error);
    return res.status(500).json({ error: "Error al hablar con Rigbot" });
  }
}

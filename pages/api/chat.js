import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = 'g-681a328b9f748191a1dd2ac35c09a2f4'; // Tu GPT personalizado

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Falta el mensaje del usuario' });
  }

  try {
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: message
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID
    });

    // 🩹 Parche: esperar máximo 20 segundos (10 intentos de 2 segundos)
    let status = 'queued';
    let attempts = 0;
    const maxAttempts = 10; // máximo 10 intentos
    while (status !== 'completed' && attempts < maxAttempts) {
      const currentRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      status = currentRun.status;
      if (status === 'completed') break;
      if (status === 'failed') throw new Error('La ejecución falló');
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000)); // espera 2s
    }

    if (status !== 'completed') {
      return res.status(500).json({ error: 'El modelo tardó demasiado en responder' });
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const response = messages.data
      .filter(m => m.role === 'assistant')
      .map(m => m.content[0]?.text?.value)
      .filter(Boolean)
      .join('\n');

    return res.status(200).json({ response });

  } catch (error) {
    console.error('Error al hablar con el GPT personalizado:', error);
    return res.status(500).json({ error: 'Error al hablar con Rigbot' });
  }
}

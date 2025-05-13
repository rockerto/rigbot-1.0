import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ASSISTANT_ID = 'asst_xLjjNmtyUT5eu3YzjHZRBCdl';

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
    console.log('🌟 API KEY:', process.env.OPENAI_API_KEY ? '✅ SET' : '❌ NOT SET');
    console.log('📨 Mensaje recibido:', message);

    const thread = await openai.beta.threads.create();
    console.log('✅ Thread creado:', thread.id);

    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: message
    });
    console.log('✅ Mensaje enviado al thread');

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID
    });
    console.log('✅ Run iniciado:', run.id);

    let status = 'queued';
    let attempts = 0;
    const maxAttempts = 10;
    while (status !== 'completed' && attempts < maxAttempts) {
      const currentRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      status = currentRun.status;
      console.log(`⏳ Estado intento ${attempts + 1}:`, status);
      if (status === 'completed') break;
      if (status === 'failed') throw new Error('La ejecución falló');
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (status !== 'completed') {
      console.log('❌ El modelo tardó demasiado');
      return res.status(500).json({ error: 'El modelo tardó demasiado en responder' });
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const response = messages.data
      .filter(m => m.role === 'assistant')
      .map(m => m.content[0]?.text?.value)
      .filter(Boolean)
      .join('\n');

    console.log('✅ Respuesta recibida:', response);
    return res.status(200).json({ response });

  } catch (error) {
    console.error('❌ Error al hablar con Rigbot:', error);
    return res.status(500).json({ error: 'Error al hablar con Rigbot' });
  }
}

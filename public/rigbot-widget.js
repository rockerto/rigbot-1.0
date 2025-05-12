(() => {
  const createBubble = () => {
    const bubble = document.createElement('div');
    bubble.id = 'rigbot-bubble';
    bubble.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 100px;
      width: 64px;
      height: 64px;
      background: #007bff;
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 9999;
    `;
    bubble.innerHTML = `<span style="color: white; font-size: 32px;">💬</span>`;
    document.body.appendChild(bubble);
    bubble.addEventListener('click', openChatWindow);

    // Botón flotante de WhatsApp
    const whatsapp = document.createElement('a');
    whatsapp.href = `https://wa.me/+56989967350`;
    whatsapp.target = "_blank";
    whatsapp.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 64px;
      height: 64px;
      background: #25d366;
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 9999;
      text-decoration: none;
    `;
    whatsapp.innerHTML = `<span style="color: white; font-size: 32px;">📞</span>`;
    document.body.appendChild(whatsapp);
  };

  const openChatWindow = () => {
    if (document.getElementById('rigbot-window')) return;

    const container = document.createElement('div');
    container.id = 'rigbot-window';
    container.style.cssText = `
      position: fixed;
      bottom: 100px;
      right: 20px;
      width: 320px;
      height: 400px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      z-index: 9999;
      overflow: hidden;
    `;

    container.innerHTML = `
      <div style="padding: 8px; background: #007bff; color: white; font-weight: bold;">
        Rigbot 🤖
      </div>
      <div id="rigbot-chat" style="flex: 1; padding: 10px; overflow-y: auto; font-family: sans-serif; font-size: 14px;"></div>
      <div style="display: flex; border-top: 1px solid #ddd;">
        <input type="text" id="rigbot-input" placeholder="Escribe algo..." style="flex: 1; border: none; padding: 10px;" />
        <button id="rigbot-send" style="background: #007bff; color: white; border: none; padding: 10px;">Enviar</button>
      </div>
    `;

    document.body.appendChild(container);

    document.getElementById('rigbot-send').addEventListener('click', sendMessage);
    document.getElementById('rigbot-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendMessage();
    });

    addMessage("Hola 👋 Soy Rigbot, ¿en qué puedo ayudarte hoy?");
  };

  const addMessage = (text, from = 'bot') => {
    const chat = document.getElementById('rigbot-chat');
    const bubble = document.createElement('div');
    bubble.style.margin = '8px 0';
    bubble.style.background = from === 'bot' ? '#f1f1f1' : '#dcf8c6';
    bubble.style.alignSelf = from === 'bot' ? 'flex-start' : 'flex-end';
    bubble.style.padding = '8px 12px';
    bubble.style.borderRadius = '8px';
    bubble.style.maxWidth = '80%';
    bubble.textContent = text;
    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;
  };

  const sendMessage = async () => {
    const input = document.getElementById('rigbot-input');
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    input.value = '';
    try {
      addMessage('⏳ Un momento por favor...');
      const response = await fetch('https://rigbot-1-0.vercel.app/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await response.json();
      document.getElementById('rigbot-chat').lastChild.remove();
      addMessage(data.response || 'Lo siento, no entendí eso.');
    } catch (err) {
      document.getElementById('rigbot-chat').lastChild.remove();
      addMessage('❌ Ocurrió un error al conectarme con Rigbot.');
    }
  };

  window.addEventListener('load', createBubble);
})();

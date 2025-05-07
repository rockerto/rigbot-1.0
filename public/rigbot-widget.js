// rigbot-widget.js

(function () {
  const rigbotConfig = window.rigbotConfig || {};
  const backendUrl = rigbotConfig.backendUrl || '';
  const whatsappNumber = rigbotConfig.whatsappNumber || '';

  if (!backendUrl || !whatsappNumber) {
    console.warn('[Rigbot] Configuración incompleta.');
    return;
  }

  // Estilos básicos para los botones
  const style = document.createElement('style');
  style.textContent = `
    .rigbot-floating-container {
      position: fixed;
      z-index: 9999;
    }
    #rigbot-button {
      bottom: 20px;
      right: 20px;
      background: #007bff;
      color: white;
      padding: 12px 18px;
      border-radius: 50px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    #rigbot-whatsapp {
      bottom: 20px;
      left: 20px;
      background: #25d366;
      color: white;
      padding: 12px 18px;
      border-radius: 50px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
  `;
  document.head.appendChild(style);

  // Crear botón de Rigbot
  const rigbotBtn = document.createElement('div');
  rigbotBtn.id = 'rigbot-button';
  rigbotBtn.className = 'rigbot-floating-container';
  rigbotBtn.innerText = '¿Necesitas ayuda?';
  rigbotBtn.style.position = 'fixed';
  rigbotBtn.style.bottom = '20px';
  rigbotBtn.style.right = '20px';
  rigbotBtn.addEventListener('click', async () => {
    const msg = 'Un momento por favor, consultando disponibilidad...';
    alert(msg);
    try {
      const res = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0]
        })
      });
      const data = await res.json();
      const horarios = data?.suggested?.join(', ') || 'No hay horas disponibles hoy.';
      alert('Horarios disponibles: ' + horarios + '\nPara agendar, escribe por WhatsApp.');
    } catch (err) {
      alert('Hubo un error al consultar las horas.');
    }
  });

  // Crear botón de WhatsApp
  const wspBtn = document.createElement('a');
  wspBtn.id = 'rigbot-whatsapp';
  wspBtn.className = 'rigbot-floating-container';
  wspBtn.href = `https://wa.me/${whatsappNumber.replace('+', '')}`;
  wspBtn.target = '_blank';
  wspBtn.innerText = 'WhatsApp';
  wspBtn.style.position = 'fixed';
  wspBtn.style.bottom = '20px';
  wspBtn.style.left = '20px';

  // Insertar ambos en el body
  window.addEventListener('load', () => {
    document.body.appendChild(rigbotBtn);
    document.body.appendChild(wspBtn);
  });
})();

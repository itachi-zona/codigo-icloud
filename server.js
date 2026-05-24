// ════════════════════════════════════════════════════════
//  ITACHI ZONE — Backend iCloud IMAP
//  Lee correos de iCloud y extrae códigos/links
// ════════════════════════════════════════════════════════

const express  = require('express');
const Imap     = require('imap');
const { simpleParser } = require('mailparser');
const cors     = require('cors');

const app = express();
app.use(cors());

// ════════════════════════════════════
//  CONFIGURACIÓN — cambia estos valores
// ════════════════════════════════════
const ICLOUD_USER = process.env.ICLOUD_USER || 'youngkdurn21@icloud.com';
const ICLOUD_PASS = process.env.ICLOUD_PASS || 'TU_CONTRASEÑA_DE_APP_AQUI'; // xxxx-xxxx-xxxx-xxxx
const MINUTOS_VALIDOS = 5;

// Correos alias registrados → qué servicio tienen
// Agrega aquí los alias de iCloud que quieras aceptar
const CUENTAS = {
  'dentro-habitante-2c@icloud.com': { servicio: 'netflix' },
  // 'otro-alias@icloud.com': { servicio: 'disney' },
};

// Palabras clave para filtrar por asunto
const FILTROS = {
  netflix_hogar:  ['hogar', 'household', 'ubicación', 'tv de tu hogar', 'actualiza tu hogar'],
  netflix_login:  ['código de inicio de sesión', 'sign-in code', 'inicio de sesión'],
  netflix_pass:   ['restablece', 'restablecer', 'reset', 'contraseña', 'password'],
  disney:         ['código', 'code', 'verificación', 'verification'],
};

// ════════════════════════════════════
//  FUNCIÓN IMAP — busca emails recientes
// ════════════════════════════════════
function buscarEmailsImap(palabrasClave) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user:     ICLOUD_USER,
      password: ICLOUD_PASS,
      host:     'imap.mail.me.com',
      port:     993,
      tls:      true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });

    const ahora  = new Date();
    const limite = new Date(ahora.getTime() - MINUTOS_VALIDOS * 60 * 1000);

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { imap.end(); return reject(err); }

        // Buscar emails de los últimos 10 minutos (margen extra, filtramos luego)
        const diezMin = new Date(ahora.getTime() - 10 * 60 * 1000);
        const fechaImap = diezMin.toLocaleDateString('en-US', {
          day: '2-digit', month: 'short', year: 'numeric'
        }).replace(',', '');

        // Criterio: llegados hoy o con asunto coincidente
        imap.search(['ALL', ['SINCE', fechaImap]], (err, uids) => {
          if (err || !uids || uids.length === 0) {
            imap.end();
            return resolve([]);
          }

          // Tomamos los últimos 10 mensajes como máximo
          const slice = uids.slice(-10);
          const fetch = imap.fetch(slice, { bodies: '' });
          const emails = [];

          fetch.on('message', (msg) => {
            let buffer = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              stream.once('end', () => {
                simpleParser(buffer).then((parsed) => {
                  emails.push(parsed);
                }).catch(() => {});
              });
            });
          });

          fetch.once('error', (err) => { imap.end(); reject(err); });
          fetch.once('end', () => {
            imap.end();
            // Filtrar por fecha y palabras clave en asunto
            const filtrados = emails.filter(mail => {
              const fecha = mail.date ? new Date(mail.date) : new Date(0);
              if (fecha < limite) return false;
              const asunto = (mail.subject || '').toLowerCase();
              return palabrasClave.some(p => asunto.includes(p.toLowerCase()));
            });
            // Ordenar de más reciente a más antiguo
            filtrados.sort((a, b) => new Date(b.date) - new Date(a.date));
            resolve(filtrados);
          });
        });
      });
    });

    imap.once('error', (err) => reject(err));
    imap.connect();
  });
}

// ════════════════════════════════════
//  EXTRACTOR DE VALORES
// ════════════════════════════════════
function extraerValor(servicio, cuerpo) {
  if (servicio === 'netflix_hogar') {
    const patrones = [
      /https:\/\/www\.netflix\.com\/account\/travel\/[^\s"'<>\)\\]+/gi,
      /https:\/\/www\.netflix\.com\/[^\s"'<>\)\\]*travel[^\s"'<>\)\\]+/gi,
      /https:\/\/www\.netflix\.com\/account\/[^\s"'<>\)\\]{30,}/gi,
    ];
    for (const p of patrones) {
      const m = cuerpo.match(p);
      if (m?.[0]) return { valor: m[0].replace(/['">\s\\]+$/, '').trim(), tipo: 'link' };
    }
  }

  if (servicio === 'netflix_login') {
    const patrones = [
      /c[oó]digo de inicio de sesi[oó]n[^0-9]*([0-9]{4,6})/i,
      /sign.in code[^0-9]*([0-9]{4,6})/i,
      /c[oó]digo[^0-9]*([0-9]{4,6})/i,
      />\s*([0-9]{4,6})\s*</,
      /\b([0-9]{6})\b/,
      /\b([0-9]{4})\b/,
    ];
    for (const p of patrones) {
      const m = cuerpo.match(p);
      if (m) return { valor: m[1], tipo: 'codigo' };
    }
  }

  if (servicio === 'netflix_pass') {
    const patrones = [
      /https:\/\/www\.netflix\.com\/[^\s"'<>\)\\]*password[^\s"'<>\)\\]+/gi,
      /https:\/\/www\.netflix\.com\/[^\s"'<>\)\\]*reset[^\s"'<>\)\\]+/gi,
      /https:\/\/www\.netflix\.com\/account\/[^\s"'<>\)\\]{30,}/gi,
    ];
    for (const p of patrones) {
      const m = cuerpo.match(p);
      if (m?.[0]) return { valor: m[0].replace(/['">\s\\]+$/, '').trim(), tipo: 'link' };
    }
  }

  if (servicio === 'disney') {
    const patrones = [
      /c[oó]digo[^0-9]*([0-9]{6})/i,
      />\s*([0-9]{6})\s*</,
      /\b([0-9]{6})\b/,
    ];
    for (const p of patrones) {
      const m = cuerpo.match(p);
      if (m) return { valor: m[1], tipo: 'codigo' };
    }
  }

  return null;
}

function mensajeVacio(s) {
  if (s === 'netflix_hogar') return 'No hay email de Hogar en los últimos 5 min. Solicítalo desde Netflix.';
  if (s === 'netflix_login') return 'No hay código de inicio de sesión en los últimos 5 min.';
  if (s === 'netflix_pass')  return 'No hay email de restablecimiento de contraseña en los últimos 5 min.';
  return 'No hay código de Disney+ en los últimos 5 min.';
}

// ════════════════════════════════════
//  ENDPOINT PRINCIPAL
// ════════════════════════════════════
app.get('/', async (req, res) => {
  const servicio = (req.query.servicio || '').trim();
  const correo   = (req.query.correo  || '').toLowerCase().trim();

  if (!servicio || !correo) {
    return res.json({ error: 'Faltan parámetros.' });
  }

  const cuenta = CUENTAS[correo];
  if (!cuenta) {
    return res.json({ error: 'Correo no registrado.' });
  }

  // Validar que el servicio corresponda al correo
  const esNetflix = ['netflix_hogar','netflix_login','netflix_pass'].includes(servicio);
  const ok =
    (cuenta.servicio === 'netflix' && esNetflix) ||
    (cuenta.servicio === 'disney'  && servicio === 'disney');

  if (!ok) {
    return res.json({ error: 'Este correo no corresponde al servicio solicitado.' });
  }

  try {
    const palabras = FILTROS[servicio];
    const emails   = await buscarEmailsImap(palabras);

    if (!emails || emails.length === 0) {
      return res.json({ error: mensajeVacio(servicio) });
    }

    // Tomar el más reciente
    const mail  = emails[0];
    const cuerpo = (mail.text || '') + ' ' + (mail.html || '');
    const resultado = extraerValor(servicio, cuerpo);

    if (!resultado) {
      return res.json({ error: 'No se encontró el código en el email.' });
    }

    return res.json({
      success: true,
      valor:   resultado.valor,
      tipo:    resultado.tipo,
      asunto:  mail.subject || '',
      fecha:   mail.date ? new Date(mail.date).toISOString() : new Date().toISOString(),
    });

  } catch (err) {
    console.error('Error IMAP:', err.message);
    return res.json({ error: 'Error al conectar con el correo. Intenta de nuevo.' });
  }
});

// Health check para Railway/Render
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));

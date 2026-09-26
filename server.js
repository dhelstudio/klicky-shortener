/**
 * Klicky - Encurtador de Links
 * Parte 1: Sistema de Links Curtos
 *
 * Domínio final: https://www.klicky.com.br/{codigo}
 */

const express = require('express');
const { customAlphabet } = require('nanoid');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ====================== CONFIGURAÇÃO ======================
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SHORT_CODE_LENGTH = 7;

// Códigos amigáveis (sem 0/O, 1/l/I)
const generateCode = customAlphabet(
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  SHORT_CODE_LENGTH
);

// ====================== ARMAZENAMENTO (JSON) ======================
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'links.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function loadDB() {
  try {
    if (fs.existsSync(dbPath)) {
      return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler DB:', e.message);
  }
  return { links: {} };
}

function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

let db = loadDB();

// ====================== APP ======================
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Serve arquivos estáticos (tanto da pasta public quanto da raiz)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { error: 'Muitas requisições. Tente novamente em alguns minutos.' }
});

// ====================== HELPERS ======================
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function normalizeUrl(url) {
  if (!/^https?:\/\//i.test(url)) {
    return 'https://' + url;
  }
  return url;
}

// ====================== ROTA PRINCIPAL ======================
app.get('/', (req, res) => {
  // Tenta primeiro na pasta public, depois na raiz
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  const rootIndex = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  res.status(404).send('Página inicial não encontrada. Verifique se o index.html foi enviado.');
});

// ====================== API ======================

app.post('/api/shorten', createLimiter, (req, res) => {
  try {
    let { url, customCode, title } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL é obrigatória' });
    }

    url = normalizeUrl(url.trim());

    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'URL inválida. Use http:// ou https://' });
    }

    let shortCode;

    if (customCode) {
      customCode = String(customCode).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
      if (customCode.length < 3 || customCode.length > 30) {
        return res.status(400).json({ error: 'Código personalizado deve ter entre 3 e 30 caracteres' });
      }
      if (db.links[customCode]) {
        return res.status(409).json({ error: 'Este código personalizado já está em uso' });
      }
      shortCode = customCode;
    } else {
      let attempts = 0;
      do {
        shortCode = generateCode();
        attempts++;
        if (attempts > 15) {
          return res.status(500).json({ error: 'Não foi possível gerar código único. Tente novamente.' });
        }
      } while (db.links[shortCode]);
    }

    const now = new Date().toISOString();
    db.links[shortCode] = {
      original_url: url,
      title: title || null,
      clicks: 0,
      created_at: now,
      last_clicked_at: null
    };
    saveDB(db);

    const shortUrl = `${BASE_URL}/${shortCode}`;

    res.status(201).json({
      success: true,
      short_url: shortUrl,
      short_code: shortCode,
      original_url: url,
      title: title || null
    });
  } catch (err) {
    console.error('Erro ao encurtar:', err);
    res.status(500).json({ error: 'Erro interno ao criar link' });
  }
});

app.get('/api/stats/:code', (req, res) => {
  const link = db.links[req.params.code];
  if (!link) {
    return res.status(404).json({ error: 'Link não encontrado' });
  }
  res.json({
    short_code: req.params.code,
    short_url: `${BASE_URL}/${req.params.code}`,
    original_url: link.original_url,
    title: link.title,
    clicks: link.clicks,
    created_at: link.created_at,
    last_clicked_at: link.last_clicked_at
  });
});

app.get('/api/links', (req, res) => {
  const list = Object.entries(db.links)
    .map(([code, data]) => ({
      short_code: code,
      short_url: `${BASE_URL}/${code}`,
      original_url: data.original_url,
      title: data.title,
      clicks: data.clicks,
      created_at: data.created_at
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);

  res.json(list);
});

// ====================== REDIRECIONAMENTO ======================
app.get('/:code', (req, res) => {
  const { code } = req.params;

  if (code === 'api' || code.includes('.')) {
    return res.status(404).send('Não encontrado');
  }

  const link = db.links[code];
  if (!link) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Link não encontrado | Klicky</title>
        <style>
          body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0b; color: #f4f4f5; }
          .box { text-align: center; }
          h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
          a { color: #a78bfa; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>Link não encontrado</h1>
          <p>Este link curto não existe ou foi removido.</p>
          <p><a href="/">Voltar para o Klicky</a></p>
        </div>
      </body>
      </html>
    `);
  }

  // Conta o clique
  link.clicks += 1;
  link.last_clicked_at = new Date().toISOString();
  saveDB(db);

  res.redirect(302, link.original_url);
});

// ====================== START ======================
app.listen(PORT, () => {
  console.log(`\n🚀 Klicky Shortener rodando!`);
  console.log(`   Porta: ${PORT}`);
  console.log(`   Base URL: ${BASE_URL}\n`);
});

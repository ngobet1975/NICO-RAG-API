// server.js
// API NICO-RAG — Express + Azure OpenAI (chat)

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // v2 (CommonJS)

const app = express();

/* -------------------- Config / Env -------------------- */
const PORT = process.env.PORT || 8080;

// Origines autorisées (séparées par des virgules)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Azure OpenAI
const AOAI_ENDPOINT   = (process.env.AOAI_ENDPOINT || '').replace(/\/+$/, ''); // sans trailing slash
const AOAI_KEY        = process.env.AOAI_KEY || '';
const AOAI_DEPLOYMENT = process.env.AOAI_DEPLOYMENT || 'gpt-chat';
const AOAI_API_VERSION = process.env.AOAI_API_VERSION || '2024-06-01';

// Divers
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

/* -------------------- Middlewares -------------------- */
app.use(express.json({ limit: '1mb' }));

// CORS au tout début + pré-vol OPTIONS
const corsOptions = {
  origin: (origin, cb) => {
    // Autoriser l’absence d’origin (ex: outils, curl) et les origines listées
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin blocked: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // laisser à false si tu n’utilises pas de cookies cross-site
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* -------------------- Helpers -------------------- */
function log(level, ...args) {
  const order = { error: 0, warn: 1, info: 2, debug: 3 };
  if (order[level] <= order[LOG_LEVEL]) {
    // eslint-disable-next-line no-console
    console[level](`[${new Date().toISOString()}]`, ...args);
  }
}

async function callAzureOpenAI(messages, opts = {}) {
  if (!AOAI_ENDPOINT || !AOAI_KEY) {
    throw new Error('Azure OpenAI is not configured. Check AOAI_ENDPOINT and AOAI_KEY.');
  }

  const url = `${AOAI_ENDPOINT}/openai/deployments/${encodeURIComponent(
    AOAI_DEPLOYMENT
  )}/chat/completions?api-version=${encodeURIComponent(AOAI_API_VERSION)}`;

  const body = {
    messages,
    temperature: 0.2,
    max_tokens: 800,
    ...opts,
  };

  log('debug', 'AOAI request:', { url, body });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': AOAI_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const err = new Error(`Azure OpenAI error ${r.status}: ${txt}`);
    err.status = r.status;
    err.body = txt;
    throw err;
  }

  return r.json();
}

/* -------------------- Routes -------------------- */

// Santé simple
app.get('/health', (_req, res) => res.status(200).send('ok'));

// Racine : vérif API (utilisée par ton bouton “Tester l’appel API”)
app.get('/', (_req, res) => {
  res.status(200).type('text/plain').send('API OK (Easy Auth)');
});

// Garde pour /chat : accepter OPTIONS (géré par app.options) et POST uniquement
app.all('/chat', (req, res, next) => {
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.method !== 'POST') return res.status(405).send('Use POST /chat');
  return next();
});

// POST /chat : { message: string } OU { messages: [{role, content}, ...] }
app.post('/chat', async (req, res) => {
  try {
    const { message, messages: incomingMessages, system } = req.body || {};

    // Construire les messages au format OpenAI
    let msgs = Array.isArray(incomingMessages)
      ? incomingMessages
      : [{ role: 'user', content: String(message || '').trim() }];

    if (!msgs.length || !msgs.some(m => (m.content || '').trim())) {
      return res.status(400).json({ error: 'bad_request', detail: 'Empty message.' });
    }

    // Optionnel: message système
    if (system && typeof system === 'string') {
      msgs = [{ role: 'system', content: system }, ...msgs];
    }

    const data = await callAzureOpenAI(msgs);

    // Réponse “chat-completions” standard
    return res.status(200).json({
      id: data.id,
      model: data.model,
      created: data.created,
      choices: data.choices,
      usage: data.usage,
    });
  } catch (err) {
    log('error', 'CHAT error', err);
    const status = err.status || 500;
    return res.status(status).json({
      error: 'server_error',
      detail: err.message || String(err),
    });
  }
});

/* -------------------- 404 & Error handler -------------------- */
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

app.use((err, _req, res, _next) => {
  log('error', 'Unhandled error', err);
  res.status(500).json({ error: 'unhandled', detail: err && err.message });
});

/* -------------------- Start -------------------- */
app.listen(PORT, () => {
  log('info', `API listening on :${PORT}`, {
    ALLOWED_ORIGINS,
    AOAI_ENDPOINT,
    AOAI_DEPLOYMENT,
    AOAI_API_VERSION,
  });
});

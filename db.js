'use strict';
/**
 * DB — Banco de dados com PostgreSQL (Railway) + fallback JSON local
 * Usa DATABASE_URL quando disponível (Railway), senão usa arquivo local
 */
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

const SCHEMA = {
  users:   [],
  market:  [],
  chat:    {},
  matches: [],
  notifs:  {},
  online:  {},
  news:    [],
  links:   {},
  newsSent:[],
  waMsgs:  [],
};

let _db      = { ...SCHEMA };
let _dirty   = false;
let _writing = false;
let _pgClient = null;

// ── PostgreSQL setup ──────────────────────────────────────────
async function setupPG() {
  if (!process.env.DATABASE_URL) return false;
  try {
    const { Client } = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    // Cria tabela se não existir
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    _pgClient = client;
    console.log('[DB] ✅ PostgreSQL conectado');
    return true;
  } catch(e) {
    console.log('[DB] ⚠️ PostgreSQL falhou, usando JSON local:', e.message);
    return false;
  }
}

// ── Lê estado do PostgreSQL ───────────────────────────────────
async function loadFromPG() {
  if (!_pgClient) return false;
  try {
    const res = await _pgClient.query('SELECT key, value FROM app_state');
    for (const row of res.rows) {
      if (_db.hasOwnProperty(row.key)) {
        _db[row.key] = row.value;
      }
    }
    const userCount = (_db.users||[]).length;
    console.log(`[DB] ✅ PostgreSQL carregado: ${userCount} usuários`);
    return true;
  } catch(e) {
    console.log('[DB] ⚠️ Erro ao carregar PostgreSQL:', e.message);
    return false;
  }
}

// ── Salva estado no PostgreSQL ────────────────────────────────
async function saveToPG() {
  if (!_pgClient) return;
  try {
    const keys = ['users','market','chat','matches','notifs','online','news','links','newsSent','waMsgs'];
    for (const key of keys) {
      await _pgClient.query(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [key, JSON.stringify(_db[key])]
      );
    }
    _dirty = false;
  } catch(e) {
    console.log('[DB] ⚠️ Erro ao salvar PostgreSQL:', e.message);
  }
}

// ── Arquivo JSON local (fallback) ─────────────────────────────
function loadLocal() {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      _db = { ...SCHEMA, ...raw };
      console.log(`[DB] Local: ${_db.users.length} usuários`);
    }
  } catch(e) {
    console.error('[DB] Erro local:', e.message);
  }
}

function saveLocal() {
  if (_writing) { _dirty = true; return; }
  _writing = true;
  const tmp = DB_FILE + '.tmp';
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(_db), 'utf8');
    fs.renameSync(tmp, DB_FILE);
    _dirty = false;
  } catch(e) {
    console.error('[DB] Erro ao salvar local:', e.message);
  } finally {
    _writing = false;
    if (_dirty) saveLocal();
  }
}

function save() {
  saveLocal();
  if (_pgClient) saveToPG().catch(() => {});
}

function markDirty() { _dirty = true; }

// Auto-save a cada 5s
setInterval(() => { if (_dirty) save(); }, 5000);

// Graceful shutdown
process.on('SIGTERM', () => { if (_dirty) save(); process.exit(0); });
process.on('SIGINT',  () => { if (_dirty) save(); process.exit(0); });

// Inicialização
async function load() {
  loadLocal(); // carrega arquivo local primeiro (rápido)
  const pgOk = await setupPG(); // conecta ao PostgreSQL
  if (pgOk) {
    await loadFromPG(); // sobrescreve com dados do PG (mais recentes)
    saveLocal();        // persiste local como cache
  }
}

let _isReady = false;
const _readyPromise = load().then(() => { _isReady = true; }).catch(e => {
  console.error('[DB] Init error:', e.message);
  _isReady = true;
});
db.isReady   = () => _isReady;
db.waitReady = () => _readyPromise;

// ── API do banco ──────────────────────────────────────────────
const db = {
  raw:  () => _db,
  save,

  users: {
    all:   ()       => _db.users,
    find:  (phone)  => _db.users.find(u => u.phone === phone),
    upsert: (phone, data) => {
      const idx = _db.users.findIndex(u => u.phone === phone);
      if (idx >= 0) _db.users[idx] = { ..._db.users[idx], ...data, phone };
      else          _db.users.push({ phone, ...data, ts: Date.now() });
      markDirty();
      return _db.users.find(u => u.phone === phone);
    },
    delete: (phone) => { _db.users = _db.users.filter(u => u.phone !== phone); markDirty(); },
    updateStickers: (phone, stickers) => {
      const u = _db.users.find(u => u.phone === phone);
      if (u) { u.stickers = stickers; u.lastSync = Date.now(); markDirty(); }
    },
    count: () => _db.users.length,
  },

  market: {
    all:    ()     => _db.market,
    add:    (item) => { _db.market.push(item); markDirty(); },
    remove: (id)   => { _db.market = _db.market.filter(m => m.id !== id); markDirty(); },
    set:    (list) => { _db.market = list; markDirty(); },
  },

  chat: {
    all:     ()          => _db.chat,
    get:     (cid)       => _db.chat[cid] || [],
    addMsg:  (cid, msg)  => {
      if (!_db.chat[cid]) _db.chat[cid] = [];
      _db.chat[cid].push(msg);
      if (_db.chat[cid].length > 200) _db.chat[cid] = _db.chat[cid].slice(-200);
      markDirty();
    },
    set:     (cid, msgs) => { _db.chat[cid] = msgs; markDirty(); },
    clear:   ()          => { _db.chat = {}; markDirty(); },
  },

  matches: {
    all:    ()         => _db.matches,
    find:   (id)       => _db.matches.find(m => m.id === id),
    add:    (m)        => { _db.matches.push(m); markDirty(); },
    update: (id, data) => {
      const idx = _db.matches.findIndex(m => m.id === id);
      if (idx >= 0) { _db.matches[idx] = { ..._db.matches[idx], ...data }; markDirty(); }
    },
    set:    (list)     => { _db.matches = list; markDirty(); },
  },

  notifs: {
    get:      (phone)       => _db.notifs[phone] || [],
    add:      (phone, n)    => {
      if (!_db.notifs[phone]) _db.notifs[phone] = [];
      _db.notifs[phone].unshift({ ...n, ts: Date.now(), read: false });
      _db.notifs[phone] = _db.notifs[phone].slice(0, 50);
      markDirty();
    },
    markRead: (phone)       => {
      if (_db.notifs[phone]) { _db.notifs[phone].forEach(n => n.read = true); markDirty(); }
    },
  },

  online: {
    ping: (phone) => { _db.online[phone] = Date.now(); markDirty(); },
    get:  ()      => {
      const now = Date.now();
      Object.keys(_db.online).forEach(p => {
        if (now - _db.online[p] > 120000) delete _db.online[p];
      });
      return _db.online;
    },
  },

  news: {
    get:  ()      => _db.news,
    set:  (list)  => { _db.news = list; _db.newsTs = Date.now(); markDirty(); },
    ts:   ()      => _db.newsTs || 0,
  },

  links: {
    all:  ()           => _db.links,
    get:  (code)       => _db.links[code],
    set:  (code, data) => { _db.links[code] = data; markDirty(); },
    hit:  (code)       => { if (_db.links[code]) { _db.links[code].hits = (_db.links[code].hits||0)+1; markDirty(); } },
  },

  newsSent: {
    has:   (id)  => _db.newsSent.some(n => n.id === id),
    add:   (id)  => { _db.newsSent.push({ id, ts: Date.now() }); markDirty(); },
    clean: ()    => {
      const cutoff = Date.now() - 48*60*60*1000;
      _db.newsSent = _db.newsSent.filter(n => n.ts > cutoff);
      markDirty();
    },
    clear: ()    => { _db.newsSent = []; markDirty(); },
  },

  waMsgs: {
    add:    (to, type, ok) => {
      _db.waMsgs.unshift({ to, type, ok, ts: Date.now() });
      _db.waMsgs = _db.waMsgs.slice(0, 500);
      markDirty();
    },
    all:    ()     => _db.waMsgs,
    recent: (n=50) => _db.waMsgs.slice(0, n),
  },

  state: {
    get: () => ({
      users:   _db.users,
      market:  _db.market,
      chat:    _db.chat,
      matches: _db.matches,
      notifs:  _db.notifs,
      online:  db.online.get(),
      ts:      Date.now()
    }),
    set: (s) => {
      if (s.users)   _db.users   = s.users;
      if (s.market)  _db.market  = s.market;
      if (s.chat)    _db.chat    = s.chat;
      if (s.matches) _db.matches = s.matches;
      if (s.notifs)  _db.notifs  = s.notifs;
      markDirty();
    }
  }
};

module.exports = db;

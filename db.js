'use strict';
/**
 * DB — Banco de dados JSON atômico para Railway
 * Sem dependências nativas. Persiste em data/db.json
 * Thread-safe com write queue para evitar corrupção
 */
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

// Schema inicial
const SCHEMA = {
  users:   [],   // [{phone, name, passHash, avatar, stickers:{}, ts, lastSync}]
  market:  [],   // [{id, owner, code, type, price, ts}]
  chat:    {},   // {'phone1__phone2': [{from, text, ts}]}
  matches: [],   // [{id, from, to, give, want, status, ts}]
  notifs:  {},   // {phone: [{type, text, ico, ts, read}]}
  online:  {},   // {phone: timestamp}
  news:    [],   // cache de notícias do RPA
  links:   {},   // {code: {url, hits, created}}
  newsSent:[],   // [{id, ts}] — notícias já enviadas
  waMsgs:  [],   // [{to, type, ts, ok}] — histórico de msgs WA enviadas
};

// Carrega banco na memória
let _db = { ...SCHEMA };
let _dirty = false;
let _writing = false;
const _writeQueue = [];

function load() {
  try {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      _db = { ...SCHEMA, ...raw };
      console.log(`[DB] Carregado: ${_db.users.length} usuários, ${_db.market.length} anúncios`);
    } else {
      save();
      console.log('[DB] Banco criado do zero');
    }
  } catch(e) {
    console.error('[DB] Erro ao carregar:', e.message);
  }
}

function save() {
  if (_writing) { _dirty = true; return; }
  _writing = true;
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(_db), 'utf8');
    fs.renameSync(tmp, DB_FILE); // atômico
    _dirty = false;
  } catch(e) {
    console.error('[DB] Erro ao salvar:', e.message);
  } finally {
    _writing = false;
    if (_dirty) save(); // write que chegou enquanto escrevia
  }
}

// Salva automaticamente a cada 5s se houve mudanças
setInterval(() => { if (_dirty) save(); }, 5000);

// Graceful shutdown
process.on('SIGTERM', () => { if (_dirty) save(); process.exit(0); });
process.on('SIGINT',  () => { if (_dirty) save(); process.exit(0); });

// ── API do banco ──────────────────────────────────────────────
const db = {
  // Acesso bruto (para migrations internas)
  raw: () => _db,
  save,

  // ── USUÁRIOS ──────────────────────────────────────────────
  users: {
    all: ()      => _db.users,
    find: (phone)=> _db.users.find(u => u.phone === phone),
    upsert: (phone, data) => {
      const idx = _db.users.findIndex(u => u.phone === phone);
      if (idx >= 0) {
        _db.users[idx] = { ..._db.users[idx], ...data, phone };
      } else {
        _db.users.push({ phone, ...data, ts: Date.now() });
      }
      _dirty = true;
      return _db.users.find(u => u.phone === phone);
    },
    delete: (phone) => {
      _db.users = _db.users.filter(u => u.phone !== phone);
      _dirty = true;
    },
    updateStickers: (phone, stickers) => {
      const u = _db.users.find(u => u.phone === phone);
      if (u) { u.stickers = stickers; u.lastSync = Date.now(); _dirty = true; }
    },
    count: () => _db.users.length,
  },

  // ── MERCADO ───────────────────────────────────────────────
  market: {
    all:    ()    => _db.market,
    add:    (item)=> { _db.market.push(item); _dirty = true; },
    remove: (id)  => { _db.market = _db.market.filter(m => m.id !== id); _dirty = true; },
    set:    (list)=> { _db.market = list; _dirty = true; },
  },

  // ── CHAT ─────────────────────────────────────────────────
  chat: {
    all:     ()        => _db.chat,
    get:     (cid)     => _db.chat[cid] || [],
    addMsg:  (cid, msg)=> {
      if (!_db.chat[cid]) _db.chat[cid] = [];
      _db.chat[cid].push(msg);
      if (_db.chat[cid].length > 200) _db.chat[cid] = _db.chat[cid].slice(-200);
      _dirty = true;
    },
    set:     (cid, msgs) => { _db.chat[cid] = msgs; _dirty = true; },
    clear:   ()          => { _db.chat = {}; _dirty = true; },
  },

  // ── MATCHES ───────────────────────────────────────────────
  matches: {
    all:    ()     => _db.matches,
    find:   (id)   => _db.matches.find(m => m.id === id),
    add:    (m)    => { _db.matches.push(m); _dirty = true; },
    update: (id, data) => {
      const idx = _db.matches.findIndex(m => m.id === id);
      if (idx >= 0) { _db.matches[idx] = { ..._db.matches[idx], ...data }; _dirty = true; }
    },
    set:    (list) => { _db.matches = list; _dirty = true; },
  },

  // ── NOTIFICAÇÕES ──────────────────────────────────────────
  notifs: {
    get:   (phone)       => _db.notifs[phone] || [],
    add:   (phone, notif)=> {
      if (!_db.notifs[phone]) _db.notifs[phone] = [];
      _db.notifs[phone].unshift({ ...notif, ts: Date.now(), read: false });
      _db.notifs[phone] = _db.notifs[phone].slice(0, 50);
      _dirty = true;
    },
    markRead: (phone)    => {
      if (_db.notifs[phone]) _db.notifs[phone].forEach(n => n.read = true);
      _dirty = true;
    },
  },

  // ── ONLINE ────────────────────────────────────────────────
  online: {
    ping:   (phone) => { _db.online[phone] = Date.now(); _dirty = true; },
    get:    ()      => {
      const now = Date.now();
      Object.keys(_db.online).forEach(p => {
        if (now - _db.online[p] > 120000) delete _db.online[p];
      });
      return _db.online;
    },
  },

  // ── NOTÍCIAS (cache RPA) ──────────────────────────────────
  news: {
    get:    ()     => _db.news,
    set:    (list) => { _db.news = list; _db.newsTs = Date.now(); _dirty = true; },
    ts:     ()     => _db.newsTs || 0,
  },

  // ── LINKS (encurtador) ─────────────────────────────────────
  links: {
    all:    ()     => _db.links,
    get:    (code) => _db.links[code],
    set:    (code, data) => { _db.links[code] = data; _dirty = true; },
    hit:    (code) => { if (_db.links[code]) { _db.links[code].hits++; _dirty = true; } },
  },

  // ── WA MSGS (histórico de envios) ────────────────────────
  waMsgs: {
    add: (to, type, ok) => {
      _db.waMsgs.unshift({ to, type, ok, ts: Date.now() });
      _db.waMsgs = _db.waMsgs.slice(0, 500); // max 500
      _dirty = true;
    },
    all: () => _db.waMsgs,
    recent: (n=50) => _db.waMsgs.slice(0, n),
  },

  // ── NEWS SENT (dedup RPA) ─────────────────────────────────
  newsSent: {
    has:    (id)   => _db.newsSent.some(n => n.id === id),
    add:    (id)   => { _db.newsSent.push({ id, ts: Date.now() }); _dirty = true; },
    clean:  ()     => {
      const cutoff = Date.now() - 48*60*60*1000;
      _db.newsSent = _db.newsSent.filter(n => n.ts > cutoff);
      _dirty = true;
    },
    clear:  ()     => { _db.newsSent = []; _dirty = true; },
  },

  // ── ESTADO COMPLETO (para sync) ───────────────────────────
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
      _dirty = true;
    }
  }
};

load();
module.exports = db;

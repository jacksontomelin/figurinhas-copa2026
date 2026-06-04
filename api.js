
// ── Z-API helpers (standalone, não depende de server.js) ──────
const fetch_node = require('node-fetch');
const ZAPI_BASE = 'https://api.z-api.io/instances/3F155B355FA8410212E52295B0810B48/token/9B855EED9711E32684160EE5';
const ZAPI_CLI  = 'Ff0f0920827ca4987818cafa9ba0f97a7S';
const ZAPI_GRP  = '120363409442378564-group';
const APP_URL   = 'https://copa2026.familiatomelin.com.br';
const GRP_LINK  = 'https://chat.whatsapp.com/Ke3Dn4Zm3qREy3FF2OtRJW';

function sanitizePhone(p) {
  const d = String(p).replace(/\D/g,'');
  return d.startsWith('55') ? d : '55' + d;
}

async function zapiSend(phone, message) {
  try {
    const r = await fetch_node(ZAPI_BASE + '/send-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLI },
      body: JSON.stringify({ phone, message }),
      timeout: 20000
    });
    if (!r.ok) {
      const errBody = await r.text().catch(()=>'');
      console.error('[WA] HTTP '+r.status+' para '+phone+':', errBody.substring(0,150));
      return { ok: false, error: 'HTTP '+r.status, body: errBody };
    }
    const d = await r.json().catch(() => ({}));
    const ok = !!(d.messageId || d.zaapId);
    if (!ok) console.error('[WA] Sem messageId para '+phone+':', JSON.stringify(d).substring(0,200));
    else console.log('[WA] ✅ Enviado para '+phone);
    return { ok, ...d };
  } catch(e) {
    console.error('[WA] Erro '+phone+':', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendWelcomeWA(phone, name, passHash, plainPass, cidade) {
  const firstName = (name||'').split(' ')[0];
  // Mostra a senha real mascarada (ex: mi**** para "minha123")
  // Se não tiver a senha real, mostra aviso de usar a que cadastrou
  // plainPass = senha em texto enviada pelo frontend (nunca armazenada)
  let masked;
  if (plainPass && typeof plainPass === 'string' && plainPass.length >= 2 && plainPass.length <= 50) {
    // Parece ser a senha real (não um hash)
    masked = plainPass.substring(0, 2) + '*'.repeat(Math.max(2, plainPass.length - 2));
    console.log('[WA] Usando senha real mascarada para ' + phone);
  } else {
    // plainPass não disponível ou suspeito
    masked = '(a senha que você escolheu)';
    console.log('[WA] plainPass não disponível para ' + phone + ' - usando texto genérico');
  }
  const cleanPhone = sanitizePhone(phone);

  // Mensagem particular
  const msgPrivada =
    `🏆 *Olá, ${firstName}! Bem-vindo(a) à Família Tomelin!* 🎉\n\n` +
    `Seu cadastro no sistema de figurinhas da Copa 2026 foi confirmado!\n\n` +
    `🔑 *Seus dados de acesso:*\n` +
    `📱 Login: *${phone.replace(/\D/g,'')}*\n` +
    `🔒 Senha: *${masked}*\n\n` +
    `👉 *Acesse o sistema:*\n${APP_URL}\n\n` +
    `📱 *Grupo WhatsApp:*\n${GRP_LINK}\n\n` +
    `_Guarde esses dados! Família Tomelin · Copa 2026_ 🏆`;

  // Tenta enviar mensagem pessoal (com 1 retry se falhar)
  let r1 = await zapiSend(cleanPhone, msgPrivada);
  if (!r1.ok) {
    console.log('[WA] Retry personal em 3s...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    r1 = await zapiSend(cleanPhone, msgPrivada);
  }
  console.log('[WA] Particular ' + name + ' (' + cleanPhone + '):', r1.ok ? '✅' : '❌ ' + (r1.error||JSON.stringify(r1).substring(0,100)));
  db.waMsgs.add(cleanPhone, 'welcome', r1.ok);

  // Mensagem no grupo
  const msgGrupo =
    `🎉 *NOVO MEMBRO NA FAMÍLIA TOMELIN!*\n\n` +
    `👋 Bem-vindo(a), *${name}*! Agora é só marcar suas figurinhas e trocar! 🎴\n\n` +
    `👉 ${APP_URL}\n_Família Tomelin · Copa 2026_ 🏆`;

  const r2 = await zapiSend(ZAPI_GRP, msgGrupo);
  console.log('[WA] Grupo:', r2.ok ? '✅' : '❌ ' + (r2.error||''));
  db.waMsgs.add('group', 'new_member', r2.ok);

  return { particular: r1.ok, grupo: r2.ok };
}

'use strict';
/**
 * API REST completa — Railway como fonte da verdade
 * Todos os endpoints de dados do sistema
 */
const express = require('express');
const router  = express.Router();
const db      = require('./db');

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

// ── OPTIONS preflight ─────────────────────────────────────────
router.options('*', (req, res) => { cors(res); res.sendStatus(200); });

// ════════════════════════════════════════════════════════════
// 🔐 AUTH
// ════════════════════════════════════════════════════════════

// POST /api/auth/register
router.post('/auth/register', async (req, res) => {
  cors(res);
  const { phone: rawPhone, name, passHash, plainPass, avatar, cidade, stickers, ts } = req.body;
  if (!rawPhone || !passHash) return res.json({ ok: false, error: 'phone e passHash obrigatórios' });
  const phone = String(rawPhone).replace(/\D/g, '');
  if (!phone) return res.json({ ok: false, error: 'Telefone inválido' });

  const existing = db.users.find(phone);
  // Salva no banco SEM a senha em texto (só o hash)
  const user = db.users.upsert(phone, { name: name||phone, passHash, avatar: avatar||'⚽', cidade: cidade||'SC', stickers: stickers||{}, ts: ts||Date.now() });

  res.json({ ok: true, action: existing ? 'updated' : 'created', user: safe(user) });

  // Envia WA em background apenas para novos usuários
  if (!existing) {
    // Usa plainPass se disponível (senha real), senão mascara o hash
    const passForWA = plainPass || null;
    setImmediate(() => sendWelcomeWA(phone, name, passHash, passForWA, cidade).catch(e => console.error('[WA]', e.message)));
  }
});

// POST /api/auth/login
router.post('/auth/login', (req, res) => {
  cors(res);
  const { phone, passHash } = req.body;
  if (!phone || !passHash) return res.json({ ok: false, error: 'Campos obrigatórios' });
  const clean = phone.replace(/\D/g, '');
  const user  = db.users.all().find(u =>
    u.phone.replace(/\D/g,'') === clean || u.phone === phone
  );
  if (!user)              return res.json({ ok: false, error: 'Usuário não encontrado' });
  if (user.passHash !== passHash) return res.json({ ok: false, error: 'Senha incorreta' });
  db.online.ping(user.phone);
  res.json({ ok: true, user: safe(user) });
});

// POST /api/auth/logout
router.post('/auth/logout', (req, res) => {
  cors(res);
  const { phone } = req.body;
  if (phone) {
    const on = db.online.get();
    delete on[phone];
  }
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 👤 USUÁRIOS
// ════════════════════════════════════════════════════════════

// GET /api/users — todos os usuários (sem passHash)
router.get('/users', (req, res) => {
  cors(res);
  res.json({ ok: true, users: db.users.all().map(safe) });
});

// GET /api/users/:phone
router.get('/users/:phone', (req, res) => {
  cors(res);
  const u = db.users.find(req.params.phone);
  if (!u) return res.json({ ok: false, error: 'Não encontrado' });
  res.json({ ok: true, user: safe(u) });
});

// POST /api/users/:phone/stickers — atualiza figurinhas
router.post('/users/:phone/stickers', (req, res) => {
  cors(res);
  const { stickers, passHash } = req.body;
  const u = db.users.find(req.params.phone);
  if (!u) return res.json({ ok: false, error: 'Usuário não encontrado' });
  if (passHash && u.passHash !== passHash) return res.json({ ok: false, error: 'Não autorizado' });
  db.users.updateStickers(req.params.phone, stickers || {});
  res.json({ ok: true });
});

// DELETE /api/users/:phone
router.delete('/users/:phone', (req, res) => {
  cors(res);
  db.users.delete(req.params.phone);
  db.market.set(db.market.all().filter(m => m.owner !== req.params.phone));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 🛒 MERCADO
// ════════════════════════════════════════════════════════════

// GET /api/market
router.get('/market', (req, res) => {
  cors(res);
  res.json({ ok: true, market: db.market.all() });
});

// POST /api/market — adiciona anúncio
router.post('/market', (req, res) => {
  cors(res);
  const item = { ...req.body, ts: req.body.ts || Date.now() };
  if (!item.id || !item.owner) return res.json({ ok: false, error: 'id e owner obrigatórios' });
  db.market.add(item);
  res.json({ ok: true, item });
});

// DELETE /api/market/:id
router.delete('/market/:id', (req, res) => {
  cors(res);
  db.market.remove(req.params.id);
  res.json({ ok: true });
});

// PUT /api/market — substitui mercado inteiro
router.put('/market', (req, res) => {
  cors(res);
  if (!Array.isArray(req.body.market)) return res.json({ ok: false });
  db.market.set(req.body.market);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 💬 CHAT
// ════════════════════════════════════════════════════════════

// GET /api/chat/:cid
router.get('/chat/:cid', (req, res) => {
  cors(res);
  res.json({ ok: true, messages: db.chat.get(req.params.cid) });
});

// GET /api/chat — todos os chats
router.get('/chat', (req, res) => {
  cors(res);
  res.json({ ok: true, chat: db.chat.all() });
});

// POST /api/chat/:cid — envia mensagem
router.post('/chat/:cid', (req, res) => {
  cors(res);
  const { from, text, ts } = req.body;
  if (!from || !text) return res.json({ ok: false, error: 'from e text obrigatórios' });
  const msg = { from, text, ts: ts || Date.now() };
  db.chat.addMsg(req.params.cid, msg);
  // Notifica o destinatário
  const phones = req.params.cid.split('__');
  const to = phones.find(p => p !== from);
  if (to) {
    const sender = db.users.find(from);
    db.notifs.add(to, {
      type: 'chat', ico: '💬',
      text: `${sender?.name?.split(' ')[0] || from}: ${text.substring(0, 60)}`
    });
  }
  res.json({ ok: true, msg });
});

// DELETE /api/chat — limpa todos os chats
router.delete('/chat', (req, res) => {
  cors(res);
  db.chat.clear();
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 🤝 MATCHES / TROCAS
// ════════════════════════════════════════════════════════════

// GET /api/matches
router.get('/matches', (req, res) => {
  cors(res);
  res.json({ ok: true, matches: db.matches.all() });
});

// POST /api/matches — cria match
router.post('/matches', (req, res) => {
  cors(res);
  const match = { ...req.body, ts: req.body.ts || Date.now(), status: 'pending' };
  if (!match.id) return res.json({ ok: false, error: 'id obrigatório' });
  db.matches.add(match);
  res.json({ ok: true, match });
});

// PUT /api/matches/:id — atualiza status
router.put('/matches/:id', (req, res) => {
  cors(res);
  db.matches.update(req.params.id, req.body);
  res.json({ ok: true });
});

// PUT /api/matches — substitui tudo
router.put('/matches/all', (req, res) => {
  cors(res);
  if (Array.isArray(req.body.matches)) db.matches.set(req.body.matches);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 🔔 NOTIFICAÇÕES
// ════════════════════════════════════════════════════════════

// GET /api/notifs/:phone
router.get('/notifs/:phone', (req, res) => {
  cors(res);
  res.json({ ok: true, notifs: db.notifs.get(req.params.phone) });
});

// POST /api/notifs/:phone — adiciona notificação
router.post('/notifs/:phone', (req, res) => {
  cors(res);
  db.notifs.add(req.params.phone, req.body);
  res.json({ ok: true });
});

// POST /api/notifs/:phone/read — marca lidas
router.post('/notifs/:phone/read', (req, res) => {
  cors(res);
  db.notifs.markRead(req.params.phone);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 🌐 ONLINE
// ════════════════════════════════════════════════════════════

// POST /api/online
router.post('/online', (req, res) => {
  cors(res);
  const { phone } = req.body;
  if (phone) db.online.ping(phone);
  res.json({ ok: true, online: db.online.get() });
});

// GET /api/online
router.get('/online', (req, res) => {
  cors(res);
  res.json({ ok: true, online: db.online.get() });
});

// ════════════════════════════════════════════════════════════
// 📦 ESTADO COMPLETO (carrega tudo de uma vez)
// ════════════════════════════════════════════════════════════

// GET /api/state — carrega tudo (usado ao abrir o app)
router.get('/state', (req, res) => {
  cors(res);
  const state = db.state.get();
  res.json({
    ok: true,
    users:   db.users.all().map(safe),
    market:  state.market  || [],
    chat:    state.chat    || {},
    matches: state.matches || [],
    notifs:  state.notifs  || {},
    online:  state.online  || {},
    news:    db.news.get() || [],
    ts:      state.ts
  });
});

// POST /api/state — salva tudo (sync completo)
router.post('/state', (req, res) => {
  cors(res);
  db.state.set(req.body);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// 📰 NOTÍCIAS (cache)
// ════════════════════════════════════════════════════════════

// GET /api/news — notícias do cache
router.get('/news', (req, res) => {
  cors(res);
  res.json({
    ok: true,
    items: db.news.get(),
    ts: db.news.ts(),
    ageSeconds: Math.floor((Date.now() - db.news.ts()) / 1000)
  });
});

// ════════════════════════════════════════════════════════════
// 🔗 LINKS (encurtador)
// ════════════════════════════════════════════════════════════

// GET /api/links
router.get('/links', (req, res) => {
  cors(res);
  const links = db.links.all();
  const list = Object.entries(links).map(([code, v]) => ({
    code, short: `/s/${code}`, url: v.url, hits: v.hits||0, created: v.created
  })).sort((a,b) => b.hits - a.hits);
  res.json({ ok: true, count: list.length, links: list });
});

// GET /api/shorten?url=...
router.get('/shorten', (req, res) => {
  cors(res);
  const { url } = req.query;
  if (!url) return res.json({ ok: false, error: 'url obrigatória' });
  const short = shortenUrl(url, req.hostname || 'copa2026.familiatomelin.com.br');
  res.json({ ok: true, short, original: url });
});

// POST /api/shorten
router.post('/shorten', (req, res) => {
  cors(res);
  const url = req.body?.url || req.query.url;
  if (!url) return res.json({ ok: false, error: 'url obrigatória' });
  const short = shortenUrl(url, req.hostname || 'copa2026.familiatomelin.com.br');
  res.json({ ok: true, short, original: url });
});

// ── helpers ──────────────────────────────────────────────────
function safe(u) {
  if (!u) return null;
  // Remove dados sensíveis
  const { passHash, _test, ...rest } = u;
  return rest;
}

function shortenUrl(url) {
  const APP_URL = 'https://copa2026.familiatomelin.com.br';
  const links = db.links.all();
  // Check existing
  const existing = Object.entries(links).find(([,v]) => v.url === url);
  if (existing) return `${APP_URL}/s/${existing[0]}`;
  // Create new
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code;
  do { code = Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (links[code]);
  db.links.set(code, { url, hits: 0, created: Date.now() });
  return `${APP_URL}/s/${code}`;
}


// GET /api/wa-msgs — histórico de mensagens WA enviadas
router.get('/wa-msgs', (req, res) => {
  cors(res);
  res.json({ ok: true, msgs: db.waMsgs.recent(100) });
});

// GET /api/wa-test/:phone — testa envio WA para um número
router.get('/wa-test/:phone', async (req, res) => {
  cors(res);
  const phone = sanitizePhone(req.params.phone);
  const msg = '✅ *Teste Z-API — Família Tomelin*\n\nSe você recebeu essa mensagem, o WhatsApp está funcionando!\n\n_' + new Date().toLocaleString('pt-BR') + '_';
  const r = await zapiSend(phone, msg);
  res.json({ ok: r.ok, phone, error: r.error, messageId: r.messageId, raw: r });
});


// POST /api/state/reload — força reload do PostgreSQL (útil para debug)
router.post('/state/reload', async (req, res) => {
  cors(res);
  try {
    const count_before = db.users.all().length;
    // Recarrega do PostgreSQL
    const { Client } = require('pg');
    if (process.env.DATABASE_URL) {
      const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await client.connect();
      const result = await client.query('SELECT key, value FROM app_state');
      const raw = db.raw();
      for (const row of result.rows) {
        if (raw.hasOwnProperty(row.key)) raw[row.key] = row.value;
      }
      await client.end();
    }
    res.json({ ok: true, users: db.users.count(), before: count_before });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});
module.exports = { router, shortenUrl };

// ═══════════════════════════════════════════════════════════════
// 🤖 FAMÍLIA TOMELIN — Bot Z-API Totalmente Automatizado
// Railway Deploy | node server.js
// ═══════════════════════════════════════════════════════════════

'use strict';
const express = require('express');

const https   = require('https');
const cron    = require('node-cron');
const pathMod = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Z-API CONFIG ──────────────────────────────────────────────
const ZAPI = {
  instance:    process.env.ZAPI_INSTANCE   || '3F155B355FA8410212E52295B0810B48',
  token:       process.env.ZAPI_TOKEN      || '9B855EED9711E32684160EE5',
  clientToken: process.env.ZAPI_CLIENT     || 'Ff0f0920827ca4987818cafa9ba0f97a7S',
  groupId:     process.env.ZAPI_GROUP_ID   || '120363409442378564-group',
};
const WC_API  = 'https://api.wc2026api.com';
const APP_URL = 'https://jacksontomelin.github.io/figurinhas-copa2026';

// ── HELPERS ───────────────────────────────────────────────────
function log(emoji, msg) {
  console.log(`${new Date().toLocaleString('pt-BR')} ${emoji} ${msg}`);
}

function httpsRequest(opts, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function zapiPost(endpoint, payload) {
  const body = JSON.stringify(payload);
  return httpsRequest({
    hostname: 'api.z-api.io',
    path: `/instances/${ZAPI.instance}/token/${ZAPI.token}/${endpoint}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Client-Token': ZAPI.clientToken,
      'Content-Length': Buffer.byteLength(body),
    }
  }, body);
}

function zapiGet(endpoint) {
  return httpsRequest({
    hostname: 'api.z-api.io',
    path: `/instances/${ZAPI.instance}/token/${ZAPI.token}/${endpoint}`,
    method: 'GET',
    headers: { 'Client-Token': ZAPI.clientToken }
  });
}

function sanitizePhone(phone) {
  const s = String(phone).trim();
  if (s.includes('@g.us') || s.includes('@c.us')) return s;
  const digits = s.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : '55' + digits;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendGroup(message) {
  try {
    const r = await zapiPost('send-text', { phone: ZAPI.groupId, message });
    if (r.status === 200 && r.body?.messageId) {
      log('✅', `Grupo ← ${message.substring(0, 60).replace(/\n/g,' ')}…`);
      return { ok: true, messageId: r.body.messageId };
    }
    log('❌', `Grupo erro ${r.status}: ${JSON.stringify(r.body)}`);
    return { ok: false, error: r.body };
  } catch(e) {
    log('❌', `sendGroup: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function sendPrivate(phone, message) {
  try {
    const p = sanitizePhone(phone);
    const r = await zapiPost('send-text', { phone: p, message });
    if (r.status === 200 && r.body?.messageId) {
      log('📩', `Privado → ${p}: ${message.substring(0,50).replace(/\n/g,' ')}…`);
      return { ok: true, messageId: r.body.messageId };
    }
    log('❌', `sendPrivate ${p} erro: ${JSON.stringify(r.body)}`);
    return { ok: false, error: r.body };
  } catch(e) {
    log('❌', `sendPrivate: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ── COPA 2026 API ─────────────────────────────────────────────
async function fetchMatchesAPI() {
  try {
    const r = await httpsRequest({
      hostname: 'api.wc2026api.com',
      path: '/matches',
      method: 'GET',
      headers: { Authorization: 'Bearer wc2026_free' },
      timeout: 8000,
    });
    if (r.status !== 200) return [];
    const arr = Array.isArray(r.body) ? r.body : r.body?.matches || r.body?.data || [];
    return arr.map(m => ({
      id: String(m.id),
      home: m.home_team || m.home || 'TBD',
      away: m.away_team || m.away || 'TBD',
      hs:   m.home_score ?? m.score?.home ?? null,
      as_:  m.away_score ?? m.score?.away ?? null,
      phase: m.phase || m.status || 'PRE',
      stadium: m.stadium || '',
      group: m.group_name || m.group || '',
      kickoff: m.kickoff_utc || m.kickoff || null,
    }));
  } catch(e) {
    log('⚠️', `fetchMatches: ${e.message}`);
    return [];
  }
}

// ── BANCO DE DADOS EM MEMÓRIA ─────────────────────────────────
// Simples, persiste enquanto o processo roda.
// Para persistência real, conecte um PostgreSQL no Railway.
let DB = {
  users:    [],   // { phone, name, stickers:{code:0|1|2}, ts }
  market:   [],   // { id, code, type, price, obs, owner, ownerName, ts }
  notified: new Set(), // pares já notificados "toPhone:code" nesta sessão
  lastScores: {},  // { matchId: { hs, as_, phase } }
  cronStats: { sent: 0, errors: 0, lastRun: null },
};

// ── MENSAGENS ─────────────────────────────────────────────────
const CURIOSIDADES = [
  `⚽ *SABIA DISSO? — COPA 2026*\n\nA Copa 2026 vai ter *48 seleções* pela 1ª vez na história!\nSão *104 jogos* em *16 estádios* em 3 países! 🌎\n\n👉 ${APP_URL}\n_Família Tomelin · Copa 2026_ 🏆`,
  `🇧🇷 *SABIA DISSO? — COPA 2026*\n\nO Brasil é o ÚNICO país a disputar TODAS as 23 edições da Copa!\nSomos únicos! 💛💚🏆\n\n👉 ${APP_URL}\n_Família Tomelin · Copa 2026_ 🏆`,
  `🏟️ *SABIA DISSO? — COPA 2026*\n\nO Estadio Azteca no México vai sediar sua *3ª Copa do Mundo* (1970, 1986 e 2026)! Único estádio do mundo com essa marca! 🎉\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `⭐ *SABIA DISSO? — COPA 2026*\n\nO *MetLife Stadium* em Nova York recebe a *FINAL* em 19 de julho!\nO Brasil também joga lá na fase de grupos! 🇧🇷🏟️\n\n👉 ${APP_URL}\n_Família Tomelin · Copa 2026_ 🏆`,
  `🎴 *SABIA DISSO? — PANINI*\n\nPara completar o álbum com sorte média você precisaria de cerca de *196 pacotinhos*!\nPor isso troque figurinhas com o grupo! 😄🔄\n\n👉 ${APP_URL}\n_Família Tomelin · Copa 2026_ 🏆`,
  `🏆 *SABIA DISSO? — COPA 2026*\n\nA premiação total da Copa 2026 é de *US$ 1 bilhão*!\nO campeão leva US$ 200 milhões! 💰⚽\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🥅 *SABIA DISSO? — COPA 2026*\n\nMiroslav Klose (Alemanha) é o maior artilheiro da história das Copas com *16 gols*!\nSerá que alguém vai superar? 👀⚽\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `💡 *SABIA DISSO? — PANINI*\n\nA Panini produz figurinhas de Copa desde *1970*, no México!\nO mesmo lugar onde a Copa 2026 vai começar! 🎴🌎\n\n👉 ${APP_URL}\n_Família Tomelin · Copa 2026_ 🏆`,
];

const MSGS_FIGURINHA = [
  `🎴 *ATENÇÃO — TROCAS DE FIGURINHAS!*\n\nJá marcou suas figurinhas no sistema? 📱\n\n✅ Veja o que falta no álbum\n⭐ Anuncie suas repetidas\n🔄 Troque com outros membros\n💬 Chat interno para combinar\n\n👉 ${APP_URL}\n\n*Bora completar o álbum!* 🏆🎴`,
  `📦 *LEMBRETE — FIGURINHAS!*\n\nVocê tem figurinhas *repetidas* guardadas sem usar? 😅\n\nNo nosso sistema você anuncia e troca com outros membros do grupo sem sair do WhatsApp!\n\n👉 ${APP_URL}\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🔄 *HORA DE TROCAR FIGURINHAS!*\n\nNossa plataforma cruza automaticamente quem tem as figuras que faltam pra você!\n\nÉ só marcar as suas repetidas que o sistema já te mostra quem chamar! 🤝\n\n👉 ${APP_URL}\n\n_Família Tomelin · Copa 2026_ 🏆`,
];

const MSGS_BRASIL = [
  `🇧🇷🇧🇷🇧🇷 *É JOGO DO BRASIL HOJE!* 🇧🇷🇧🇷🇧🇷\n\n⚽ *BORA HEXA! BORA BRASIL!* 💛💚🏆\n\nToda a Família Tomelin está na torcida!\nJá fez seu palpite no sistema? 🎲\n\n👉 ${APP_URL}\n\n#VaiBrasil #Hexa #Copa2026 #FamíliaTomelin`,
  `💛💚 *BRASIL EM CAMPO — COPA 2026!* 💛💚\n\n🦁 É HOJE! A Seleção vai em busca do *HEXACAMPEONATO*!\n\nFamília Tomelin toda unida na torcida! 🏆🔥\nAposte no resultado pelo sistema:\n👉 ${APP_URL}\n\n#BoraBrasil #Hexa #FamíliaTomelin`,
];

const MSGS_HYPE = [
  `🔥 *A COPA TÁ AÍ!* 🔥\n\n48 seleções · 104 jogos · 16 estádios\nEUA 🇺🇸 + Canadá 🇨🇦 + México 🇲🇽\n\nO Brasil vai buscar o *HEXACAMPEONATO!* 🏆🇧🇷\n\nJá completou seu álbum? Corre! 😂🎴\n👉 ${APP_URL}\n\n*#FamíliaTomelin #Copa2026 #Hexa*`,
  `🏆 *FAMÍLIA TOMELIN — COPA 2026!* ⚽\n\nFaltam poucos dias para o maior evento esportivo do planeta!\n\n📅 Abertura: 11 de junho — México × África do Sul\n🇧🇷 Brasil estreia: 13 de junho contra o Marrocos\n\nCorre completar o álbum! 🎴\n👉 ${APP_URL}\n\n_#FamíliaTomelin #Copa2026_`,
];

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── MONITOR DE JOGOS AO VIVO ──────────────────────────────────
let monitorActive = true;

async function monitorJogos() {
  if (!monitorActive) return;
  const matches = await fetchMatchesAPI();
  if (!matches.length) return;

  for (const m of matches) {
    const key   = m.id;
    const prev  = DB.lastScores[key];
    const isLive = ['1H','HT','2H','ET1','ET2','PEN'].includes(m.phase);
    const isFT   = ['FT','FT_PEN'].includes(m.phase);
    const isBR   = m.home.toLowerCase().includes('brasil') || m.away.toLowerCase().includes('brasil');

    // Jogo começou
    if (!prev && isLive) {
      DB.lastScores[key] = { hs: m.hs, as_: m.as_, phase: m.phase };
      const msg = `🔴 *BOLA ROLANDO! COPA 2026!*\n\n*${m.home} ⚔️ ${m.away}* COMEÇOU!\n\n${isBR ? '🇧🇷 *BORA BRASIL! BORA HEXA!* 💛💚🔥\n' : ''}🏟️ ${m.stadium}\n\nAcompanhe pelo sistema!\n👉 ${APP_URL}\n\n#Copa2026 #FamíliaTomelin`;
      await sendGroup(msg);
      await delay(1500);
      continue;
    }

    if (!prev) { DB.lastScores[key] = { hs: m.hs, as_: m.as_, phase: m.phase }; continue; }

    // Gol marcado
    if (isLive && m.hs !== null && m.as_ !== null && (m.hs !== prev.hs || m.as_ !== prev.as_)) {
      DB.lastScores[key] = { hs: m.hs, as_: m.as_, phase: m.phase };
      const quemMarcou = m.hs > prev.hs ? m.home : m.away;
      const gfBR = isBR && (m.home.toLowerCase().includes('brasil') ? m.hs > prev.hs : m.as_ > prev.as_);
      const msg = `⚽ *${gfBR ? 'GOOOOOL DO BRASIL! 🇧🇷💛💚' : 'GOOOOOL! COPA 2026!'}*\n\n${gfBR ? '🏆 *HEXA TÁ CHEGANDO!* 🔥\n\n' : ''}*${m.home} ${m.hs} ✕ ${m.as_} ${m.away}*\n\n⚽ Gol de ${quemMarcou}!\n\nFamília Tomelin na torcida! 🎉\n#Copa2026 #FamíliaTomelin`;
      await sendGroup(msg);
      await delay(1500);
    }

    // Intervalo
    if (isLive && m.phase === 'HT' && prev.phase !== 'HT') {
      DB.lastScores[key].phase = 'HT';
      const msg = `☕ *INTERVALO — COPA 2026*\n\n*${m.home} ${m.hs} ✕ ${m.as_} ${m.away}*\n\nPrimeiro tempo encerrado! Segundo tempo em breve! ⚽\n${isBR ? '🇧🇷 Vamos Brasil! 💛💚\n' : ''}_Família Tomelin_ 🏆`;
      await sendGroup(msg);
      await delay(1500);
    }

    // Fim de jogo
    if (isFT && !['FT','FT_PEN'].includes(prev.phase)) {
      DB.lastScores[key] = { hs: m.hs, as_: m.as_, phase: m.phase };
      let resultado = '';
      if (isBR) {
        const brHome = m.home.toLowerCase().includes('brasil');
        const brScore = brHome ? m.hs : m.as_;
        const adScore = brHome ? m.as_ : m.hs;
        resultado = brScore > adScore ? '🇧🇷 *BRASIL VENCEU! BORA HEXA!* 🏆💛💚'
                  : brScore === adScore ? '🇧🇷 Empate do Brasil. Vamos em frente! 💪'
                  : '😟 Derrota do Brasil. Cabeça erguida, ainda temos a Copa! 🇧🇷';
      }
      const msg = `🏁 *FIM DE JOGO — RESULTADO FINAL!*\n\n*${m.home} ${m.hs} ✕ ${m.as_} ${m.away}*\n\n${resultado ? resultado + '\n\n' : 'Que partida! '}Já apostou no próximo jogo? 🎲\n👉 ${APP_URL}\n#Copa2026 #FamíliaTomelin`;
      await sendGroup(msg);
      await delay(1500);
    }
  }
}

// ── CROSS-MATCH DE FIGURINHAS ─────────────────────────────────
// Roda após qualquer PUT /api/users/:phone/stickers ou POST /api/market
async function checkStickerMatches(changedPhone) {
  const owner = DB.users.find(u => u.phone === changedPhone);
  if (!owner) return;

  // Figurinhas que o owner TEM (estado 1 = tenho, 2 = repetida)
  const ownerHas = new Set(
    Object.entries(owner.stickers || {})
      .filter(([,v]) => v >= 1)
      .map(([code]) => code)
  );
  if (!ownerHas.size) return;

  // Para cada outro usuário, verifica se precisa de algo que owner tem
  for (const u of DB.users) {
    if (u.phone === changedPhone) continue;
    const need = Object.entries(u.stickers || {})
      .filter(([code, v]) => v === 0 && ownerHas.has(code))
      .map(([code]) => code);
    if (!need.length) continue;

    // Checa se já notificamos esse par nesta sessão
    const pairKey = `${u.phone}:${need.sort().join(',')}`;
    if (DB.notified.has(pairKey)) continue;
    DB.notified.add(pairKey);

    const toName   = (u.name || '').split(' ')[0];
    const fromName = owner.name || 'Um membro';
    const codeList = need.slice(0, 5).join(', ') + (need.length > 5 ? ` +${need.length - 5} mais` : '');

    const msg = `🎴 Oi *${toName}*! Boa notícia! 🎉\n\n*${fromName}* tem ${need.length > 1 ? 'figurinhas' : 'uma figurinha'} que você precisa!\n\n🃏 *${codeList}*\n\nChama agora e combina a troca antes que alguém pegue! 💨\n📱 *wa.me/55${owner.phone.replace(/\D/g,'')}*\n\n_Família Tomelin · Copa 2026_ 🏆🇧🇷`;

    await sendPrivate(u.phone, msg);
    await delay(800);
  }
}

// ── MIDDLEWARES ───────────────────────────────────────────────
app.use(require('express').json());
app.use(require('express').static(pathMod.join(__dirname)));

// ── ROTAS ─────────────────────────────────────────────────────


// Notificação de novo usuário cadastrado
app.post('/api/new-user', async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  const firstName = name.split(' ')[0];
  const templates = [
    `🎉 *NOVO MEMBRO NA FAMÍLIA TOMELIN!* 🎉\n\n👋 Bem-vindo(a), *${firstName}*! Que bom ter você aqui!\n\nAgora é só marcar suas figurinhas e trocar com a galera! 🎴🔄\n\n👉 ${APP_URL}\n\n_Família Tomelin · Copa 2026_ 🏆⚽`,
    `🎴 *${firstName} ENTROU NO SISTEMA!* 🎉\n\nBoa notícia! *${firstName}* acaba de se cadastrar no sistema de trocas da Família Tomelin! 👏\n\nBem-vindo(a)! 🇧🇷🏆\n\n👉 ${APP_URL}`,
    `⚽ *CHEGOU MAIS UM NA FAMÍLIA TOMELIN!* ⚽\n\n🙌 *${firstName}* acabou de entrar no sistema!\n\nQuanto mais gente, mais trocas! 🔥🎴\n\n👉 ${APP_URL}\n\n_Copa 2026 · Família Tomelin_ 🏆`,
    `🌟 *FAMÍLIA TOMELIN CRESCENDO!* 🌟\n\n*${firstName}* acabou de se juntar ao nosso sistema de trocas! 🎉\n\nBem-vindo(a)! 🎴 ${APP_URL}\n\n#FamíliaTomelin #Copa2026`,
    `🏆 *NOVO COLECIONADOR NA ÁREA!* 🏆\n\n👋 *${firstName}* entrou na Família Tomelin!\n\nBora completar o álbum juntos! 💪🎴\n\n👉 ${APP_URL}\n\n_Família Tomelin · Copa 2026_ ⚽`,
  ];

  const msg = templates[Math.floor(Math.random() * templates.length)];

  // Adiciona usuário ao DB local
  if (phone && !DB.users.find(u => u.phone === phone)) {
    DB.users.push({ phone, name, stickers: {}, ts: Date.now() });
    log('👤', 'Novo usuário: ' + name + ' (' + phone + ')');
  }

  const r = await sendGroup(msg);
  DB.cronStats.sent++;
  res.json(r);
});

// Health check
app.get('/health', (_, res) => res.json({
  status: 'online',
  uptime: Math.floor(process.uptime()),
  users: DB.users.length,
  market: DB.market.length,
  monitor: monitorActive,
  cronStats: DB.cronStats,
  ts: new Date().toISOString(),
}));

// Status Z-API
app.get('/api/status', async (_, res) => {
  try {
    const r = await zapiGet('status');
    res.json({ ok: r.status === 200, ...r.body });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Enviar mensagem livre ao grupo
app.post('/api/send-group', async (req, res) => {
  const { message, type } = req.body;
  let msg = message;
  if (!msg) {
    if (type === 'curiosidade')  msg = getRandom(CURIOSIDADES);
    else if (type === 'figurinha') msg = getRandom(MSGS_FIGURINHA);
    else if (type === 'brasil')    msg = getRandom(MSGS_BRASIL);
    else if (type === 'hype')      msg = getRandom(MSGS_HYPE);
    else msg = getRandom(CURIOSIDADES);
  }
  const r = await sendGroup(msg);
  DB.cronStats.sent++;
  res.json(r);
});

// Enviar mensagem privada
app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' });
  const r = await sendPrivate(phone, message);
  res.json(r);
});

// Notificação de figurinha (chamado pelo app principal via fetch)
app.post('/api/notify-sticker', async (req, res) => {
  const { toPhone, toName, fromPhone, fromName, codes } = req.body;
  if (!toPhone || !fromPhone || !codes?.length)
    return res.status(400).json({ error: 'toPhone, fromPhone e codes obrigatórios' });

  const pairKey = `${toPhone}:${[...codes].sort().join(',')}`;
  if (DB.notified.has(pairKey)) return res.json({ ok: true, skipped: true });
  DB.notified.add(pairKey);

  const codeList = codes.slice(0,5).join(', ') + (codes.length>5 ? ` +${codes.length-5} mais` : '');
  const nome = (toName||'').split(' ')[0] || 'amigo(a)';
  const msg = `🎴 Oi *${nome}*! Boa notícia! 🎉\n\n*${fromName || 'Um membro'}* tem ${codes.length>1?'figurinhas':'a figurinha'} que você precisa!\n\n🃏 *${codeList}*\n\nChama agora e combina a troca! 💨\n📱 *wa.me/55${fromPhone.replace(/\D/g,'')}*\n\n_Família Tomelin · Copa 2026_ 🏆🇧🇷`;
  const r = await sendPrivate(toPhone, msg);
  res.json(r);
});

// Sync usuários do app (o app envia o estado dos usuários)
app.post('/api/sync-users', async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users deve ser array' });
  const before = DB.users.length;

  // Detectar novos usuários ou stickers alterados
  for (const u of users) {
    const existing = DB.users.find(x => x.phone === u.phone);
    if (!existing) {
      // Novo usuário — boas-vindas no grupo
      DB.users.push(u);
      const msg = `🎉 *Novo membro na Família Tomelin!*\n\n👋 Seja bem-vindo(a), *${u.name}*!\n\nAcesse o sistema e marque suas figurinhas:\n👉 ${APP_URL}\n\n_Família Tomelin · Copa 2026_ 🏆`;
      await sendGroup(msg);
      await delay(800);
    } else {
      // Usuário existente — verificar stickers mudaram
      const hadStickers = JSON.stringify(existing.stickers || {});
      existing.stickers = u.stickers || existing.stickers;
      existing.name = u.name || existing.name;
      if (hadStickers !== JSON.stringify(existing.stickers)) {
        // Stickers mudaram — checar cross-matches
        await checkStickerMatches(u.phone);
      }
    }
  }

  // Adicionar novos que não existiam
  for (const u of users) {
    if (!DB.users.find(x => x.phone === u.phone)) DB.users.push(u);
  }

  res.json({ ok: true, before, after: DB.users.length });
});

// Sync mercado (quando alguém anuncia figurinha)
app.post('/api/sync-market', async (req, res) => {
  const { items, ownerPhone } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items deve ser array' });
  DB.market = items;

  // Notificar quem precisa das figurinhas anunciadas
  if (ownerPhone) {
    const owner = DB.users.find(u => u.phone === ownerPhone);
    const codes  = items.filter(m => m.owner === ownerPhone).map(m => m.code);
    if (owner && codes.length) {
      for (const u of DB.users) {
        if (u.phone === ownerPhone) continue;
        const needCodes = codes.filter(c => (u.stickers?.[c] ?? 0) === 0);
        if (!needCodes.length) continue;

        const pairKey = `mkt:${u.phone}:${needCodes.sort().join(',')}`;
        if (DB.notified.has(pairKey)) continue;
        DB.notified.add(pairKey);

        const toName = (u.name||'').split(' ')[0];
        const codeList = needCodes.slice(0,5).join(', ') + (needCodes.length>5 ? ` +${needCodes.length-5}` : '');
        const msg = `🏷️ Oi *${toName}*! Tem figurinha pra você! 👀\n\n*${owner.name}* acabou de anunciar no mercado:\n\n🃏 *${codeList}*\n\nCorre antes que alguém pegue! 💨\n📱 *wa.me/55${owner.phone.replace(/\D/g,'')}*\n\n_Família Tomelin · Copa 2026_ 🏆`;
        await sendPrivate(u.phone, msg);
        await delay(800);
      }
    }
  }

  res.json({ ok: true, items: DB.market.length });
});

// Jogos ao vivo
app.get('/api/jogos', async (_, res) => {
  const matches = await fetchMatchesAPI();
  res.json(matches);
});

// Monitor on/off
app.post('/api/monitor', (req, res) => {
  monitorActive = Boolean(req.body.ativo);
  log('🔧', `Monitor: ${monitorActive ? 'ATIVO' : 'PAUSADO'}`);
  res.json({ monitorActive });
});

// Listar estado
app.get('/api/info', (_, res) => res.json({
  users: DB.users.length,
  market: DB.market.length,
  monitorActive,
  cronStats: DB.cronStats,
  lastScores: Object.keys(DB.lastScores).length,
}));

// Serve HTML
app.get('/', (_, res) => res.sendFile(pathMod.join(__dirname, 'index.html')));
app.get('/bot', (_, res) => res.sendFile(pathMod.join(__dirname, 'bot.html')));
app.get('/dashboard', (_, res) => res.sendFile(pathMod.join(__dirname, 'dashboard.html')));

// ── CRON JOBS AUTOMÁTICOS ─────────────────────────────────────

// 🌅 Curiosidade diária — todo dia às 9h BRT (12h UTC)
cron.schedule('0 12 * * *', async () => {
  log('⏰', 'Cron: curiosidade diária');
  const r = await sendGroup(getRandom(CURIOSIDADES));
  if (r.ok) DB.cronStats.sent++; else DB.cronStats.errors++;
  DB.cronStats.lastRun = new Date().toISOString();
}, { timezone: 'America/Sao_Paulo' });

// 🎴 Lembrete figurinhas — terça e quinta às 11h BRT
cron.schedule('0 11 * * 2,4', async () => {
  log('⏰', 'Cron: lembrete figurinhas');
  const r = await sendGroup(getRandom(MSGS_FIGURINHA));
  if (r.ok) DB.cronStats.sent++; else DB.cronStats.errors++;
}, { timezone: 'America/Sao_Paulo' });

// 🔥 Hype fim de semana — sábado às 10h BRT
cron.schedule('0 10 * * 6', async () => {
  log('⏰', 'Cron: hype fim de semana');
  const r = await sendGroup(getRandom(MSGS_HYPE));
  if (r.ok) DB.cronStats.sent++; else DB.cronStats.errors++;
}, { timezone: 'America/Sao_Paulo' });

// 🇧🇷 Jogo do Brasil — 13, 19, 25 jun às 13h BRT
['13 6','19 6','25 6'].forEach(d => {
  const [day, month] = d.split(' ');
  cron.schedule(`0 13 ${day} ${month} *`, async () => {
    log('🇧🇷', `Cron: Brasil joga hoje! (${day}/${month})`);
    const r = await sendGroup(getRandom(MSGS_BRASIL));
    if (r.ok) DB.cronStats.sent++; else DB.cronStats.errors++;
  }, { timezone: 'America/Sao_Paulo' });
});

// ⚽ Monitor de jogos ao vivo — a cada 2 minutos
cron.schedule('*/2 * * * *', async () => {
  await monitorJogos();
}, { timezone: 'America/Sao_Paulo' });

// ♻️ Limpa pares notificados a cada 6 horas (evita acúmulo de memória)
cron.schedule('0 */6 * * *', () => {
  const before = DB.notified.size;
  DB.notified.clear();
  log('♻️', `Cache de notificações limpo (${before} pares)`);
});

// ── START ────────────────────────────────────────────────────
app.listen(PORT, () => {
  log('🚀', `Servidor rodando na porta ${PORT}`);
  log('📱', `Z-API: ${ZAPI.instance}`);
  log('👥', `Grupo: ${ZAPI.groupId}`);
  log('🤖', 'Monitor de jogos: ATIVO');
  log('⏰', 'Cron jobs: ATIVOS');
  log('📡', 'Endpoints: /health /api/status /api/send-group /api/sync-users /api/sync-market');
});

module.exports = app;

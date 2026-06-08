// ═══════════════════════════════════════════════════════════════
// 🤖 FAMÍLIA TOMELIN — Bot Z-API Totalmente Automatizado
// Railway Deploy | node server.js
// ═══════════════════════════════════════════════════════════════

'use strict';
const express = require('express');

const https   = require('https');
const cron    = require('node-cron');
const pathMod = require('path');
const db      = require('./db');
const fs      = require('fs');

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
const APP_URL = 'https://copa2026.familiatomelin.com.br';

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
    log('❌', `Erro no grupo ${r.status}: ${JSON.stringify(r.body)}`);
    return { ok: false, error: r.body };
  } catch(e) {
    log('❌', `Falha ao enviar grupo: ${e.message}`);
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
    log('❌', `Falha ao enviar privado ${p} erro: ${JSON.stringify(r.body)}`);
    return { ok: false, error: r.body };
  } catch(e) {
    log('❌', `Falha ao enviar privado: ${e.message}`);
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
    log('⚠️', `Erro ao buscar jogos: ${e.message}`);
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
  cronStats: { enviados: 0, erros: 0, ultimaExec: null },
};

// ── MENSAGENS ─────────────────────────────────────────────────
const CURIOSIDADES = [
  `⚽ *SABIA DISSO? — COPA 2026*\n\nA Copa 2026 vai ter *48 seleções* pela 1ª vez na história!\nSão *104 jogos* em *16 estádios* em 3 países! 🌎\n\nFamília Tomelin · Copa 2026 🏆`,
  `🇧🇷 *SABIA DISSO? — COPA 2026*\n\nO Brasil é o ÚNICO país a disputar TODAS as 23 edições da Copa!\nSomos únicos! 💛💚🏆\n\nFamília Tomelin · Copa 2026 🏆`,
  `🏟️ *SABIA DISSO? — COPA 2026*\n\nO Estadio Azteca no México vai sediar sua *3ª Copa do Mundo* (1970, 1986 e 2026)! Único estádio do mundo com essa marca! 🎉\n\nFamília Tomelin · Copa 2026 🏆`,
  `⭐ *SABIA DISSO? — COPA 2026*\n\nO *MetLife Stadium* em Nova York recebe a *FINAL* em 19 de julho!\nO Brasil também joga lá na fase de grupos! 🇧🇷🏟️\n\nFamília Tomelin · Copa 2026 🏆`,
  `🎴 *SABIA DISSO? — PANINI*\n\nPara completar o álbum com sorte média você precisaria de cerca de *196 pacotinhos*!\nPor isso troque figurinhas com o grupo! 😄🔄\n\nFamília Tomelin · Copa 2026 🏆`,
  `🏆 *SABIA DISSO? — COPA 2026*\n\nA premiação total da Copa 2026 é de *US$ 1 bilhão*!\nO campeão leva US$ 200 milhões! 💰⚽\n\nFamília Tomelin · Copa 2026 🏆`,
  `🥅 *SABIA DISSO? — COPA 2026*\n\nMiroslav Klose (Alemanha) é o maior artilheiro da história das Copas com *16 gols*!\nSerá que alguém vai superar? 👀⚽\n\nFamília Tomelin · Copa 2026 🏆`,
  `💡 *SABIA DISSO? — PANINI*\n\nA Panini produz figurinhas de Copa desde *1970*, no México!\nO mesmo lugar onde a Copa 2026 vai começar! 🎴🌎\n\nFamília Tomelin · Copa 2026 🏆`,
];

const MSGS_FIGURINHA = [
  `🎴 *ATENÇÃO — TROCAS DE FIGURINHAS!*\n\nJá marcou suas figurinhas no sistema? 📱\n\n✅ Veja o que falta no álbum\n⭐ Anuncie suas repetidas\n🔄 Troque com outros membros\n💬 Chat interno para combinar\n\n\n*Bora completar o álbum!* 🏆🎴`,
  `📦 *LEMBRETE — FIGURINHAS!*\n\nVocê tem figurinhas *repetidas* guardadas sem usar? 😅\n\nNo nosso sistema você anuncia e troca com outros membros do grupo sem sair do WhatsApp!\n\n\nFamília Tomelin · Copa 2026 🏆`,
  `🔄 *HORA DE TROCAR FIGURINHAS!*\n\nNossa plataforma cruza automaticamente quem tem as figuras que faltam pra você!\n\nÉ só marcar as suas repetidas que o sistema já te mostra quem chamar! 🤝\n\n\nFamília Tomelin · Copa 2026 🏆`,
];

const MSGS_BRASIL = [
  `🇧🇷🇧🇷🇧🇷 *É JOGO DO BRASIL HOJE!* 🇧🇷🇧🇷🇧🇷\n\n⚽ *BORA HEXA! BORA BRASIL!* 💛💚🏆\n\nToda a Família Tomelin está na torcida!\nJá fez seu palpite no sistema? 🎲\n\n\n#VaiBrasil #Hexa #Copa2026 #FamíliaTomelin`,
  `💛💚 *BRASIL EM CAMPO — COPA 2026!* 💛💚\n\n🦁 É HOJE! A Seleção vai em busca do *HEXACAMPEONATO*!\n\nFamília Tomelin toda unida na torcida! 🏆🔥\nAposte no resultado pelo sistema:\n\n#BoraBrasil #Hexa #FamíliaTomelin`,
];

const MSGS_HYPE = [
  `🔥 *A COPA TÁ AÍ!* 🔥\n\n48 seleções · 104 jogos · 16 estádios\nEUA 🇺🇸 + Canadá 🇨🇦 + México 🇲🇽\n\nO Brasil vai buscar o *HEXACAMPEONATO!* 🏆🇧🇷\n\nJá completou seu álbum? Corre! 😂🎴\n\n*#FamíliaTomelin #Copa2026 #Hexa*`,
  `🏆 *FAMÍLIA TOMELIN — COPA 2026!* ⚽\n\nFaltam poucos dias para o maior evento esportivo do planeta!\n\n📅 Abertura: 11 de junho — México × África do Sul\n🇧🇷 Brasil estreia: 13 de junho contra o Marrocos\n\nCorre completar o álbum! 🎴\n\n_#FamíliaTomelin #Copa2026_`,
];


// ── MENSAGENS ESPECIAIS — HORÁRIOS ESPECÍFICOS ──────────
const MSGS_MANHA = [
  `☀️ *BOM DIA, FAMÍLIA TOMELIN!* ⚽\n\nHoje é mais um dia de completar o álbum da Copa 2026! 🎴\nVeja quem tem as figurinhas que você precisa no sistema!\n\nFamília Tomelin · Copa 2026 🏆`,
  `🌅 *BOM DIA!* ⚽\n\nA Copa 2026 está chegando! Ainda tem figurinhas pra trocar?\nAcesse o sistema e veja as trocas disponíveis! 🎴🔄\n\nFamília Tomelin · Copa 2026`,
];

const MSGS_TARDE = [
  `🌞 *BOA TARDE, FAMÍLIA TOMELIN!* ⚽\n\nComo está seu álbum? Já marcou todas as figurinhas de hoje? 🎴\nO sistema está esperando por você!\n\nFamília Tomelin · Copa 2026 🏆`,
  `⚽ *BOA TARDE!*\n\nAproveitou para trocar figurinhas hoje? 🎴\nO sistema da Família Tomelin cruzou novos matches pra você!\n\nFamília Tomelin · Copa 2026`,
];

const MSGS_NOITE = [
  `🌙 *BOA NOITE, FAMÍLIA TOMELIN!* ⚽\n\nFim de dia — como foi a caçada às figurinhas? 🎴\nAmanhã tem mais! Copa 2026 chegando! 🏆\n\nFamília Tomelin · Copa 2026`,
  `⭐ *BOA NOITE!*\n\nAntes de dormir... dá uma olhada no álbum? 😄🎴\nTem matches novos esperando por você no sistema!\n\nFamília Tomelin · Copa 2026 🏆`,
];

const MSGS_CONTAGEM = [
  `⏳ *FALTAM POUCOS DIAS PARA A COPA 2026!* 🏆\n\n⚽ 48 seleções\n🌎 3 países\n🏟️ 16 estádios\n🎴 980 figurinhas\n\nSeu álbum está pronto? 💪\n\nFamília Tomelin · Copa 2026`,
  `🔥 *A COPA 2026 TÁ AÍ!* ⚽\n\nEUA · Canadá · México vão receber o maior espetáculo do futebol!\n🇧🇷 E o Brasil vai em busca do HEXA! 🏆\n\nFamília Tomelin · Copa 2026`,
  `🎴 *FIQUE LIGADO — COPA 2026!* 📅\n\nO álbum Panini tem *980 figurinhas* de 48 seleções!\nVocê já tem quantas? Veja no sistema e troque com a galera! 🔄\n\nFamília Tomelin · Copa 2026 🏆`,
];

function getRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── MONITOR DE JOGOS AO VIVO ──────────────────────────────────
let monitorActive = true;

async function monitorJogos() {
  if (!monitorActive) return;
  const matches = await fetchMatchesAPI();
    if (matches.length) _jogosCache = { data: matches, ts: Date.now() };
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
      const msg = `🔴 *BOLA ROLANDO! COPA 2026!*\n\n*${m.home} ⚔️ ${m.away}* COMEÇOU!\n\n${isBR ? '🇧🇷 *BORA BRASIL! BORA HEXA!* 💛💚🔥\n' : ''}🏟️ ${m.stadium}\n\nAcompanhe pelo sistema!\n\n#Copa2026 #FamíliaTomelin`;
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
      const msg = `☕ *INTERVALO — COPA 2026*\n\n*${m.home} ${m.hs} ✕ ${m.as_} ${m.away}*\n\nPrimeiro tempo encerrado! Segundo tempo em breve! ⚽\n${isBR ? '🇧🇷 Vamos Brasil! 💛💚\n' : ''}Família Tomelin 🏆`;
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
      const msg = `🏁 *FIM DE JOGO — RESULTADO FINAL!*\n\n*${m.home} ${m.hs} ✕ ${m.as_} ${m.away}*\n\n${resultado ? resultado + '\n\n' : 'Que partida! '}Já apostou no próximo jogo? 🎲\n#Copa2026 #FamíliaTomelin`;
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

    const msg = `🎴 Oi *${toName}*! Boa notícia! 🎉\n\n*${fromName}* tem ${need.length > 1 ? 'figurinhas' : 'uma figurinha'} que você precisa!\n\n🃏 *${codeList}*\n\nChama agora e combina a troca antes que alguém pegue! 💨\n📱 *wa.me/55${owner.phone.replace(/\D/g,'')}*\n\nFamília Tomelin · Copa 2026 🏆🇧🇷`;

    await sendPrivate(u.phone, msg);
    await delay(800);
  }
}

// ── MIDDLEWARES ───────────────────────────────────────────────
app.use(require('express').json({ limit: '5mb' }));
app.use(require('express').static(pathMod.join(__dirname)));
// CORS global
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Middleware: aguarda banco estar pronto ─────────────────────
app.use((req, res, next) => {
  if (db.isReady && db.isReady()) return next();
  // Banco ainda carregando - espera até 5s
  const t = setTimeout(() => next(), 5000);
  db.waitReady().then(() => { clearTimeout(t); next(); }).catch(() => { clearTimeout(t); next(); });
});

// ── API REST (db.js + api.js) ─────────────────────────────────
const { router: apiRouter } = require('./api');
app.use('/api', apiRouter);

// ── ROTAS LEGADAS ─────────────────────────────────────────────


// Notificação de novo usuário cadastrado
app.post('/api/new-user', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Campo name obrigatório' });
  log('👤', 'Novo usuário: ' + name + ' (' + (phone||'sem tel') + ')');

  const firstName = name.split(' ')[0];
  const templates = [
    `🎉 *NOVO MEMBRO NA FAMÍLIA TOMELIN!* 🎉\n\n👋 Bem-vindo(a), *${firstName}*! Que bom ter você aqui!\n\nAgora é só marcar suas figurinhas e trocar com a galera! 🎴🔄\n\n\nFamília Tomelin · Copa 2026 🏆⚽`,
    `🎴 *${firstName} ENTROU NO SISTEMA!* 🎉\n\nBoa notícia! *${firstName}* acaba de se cadastrar no sistema de trocas da Família Tomelin! 👏\n\nBem-vindo(a)! 🇧🇷🏆\n`,
    `⚽ *CHEGOU MAIS UM NA FAMÍLIA TOMELIN!* ⚽\n\n🙌 *${firstName}* acabou de entrar no sistema!\n\nQuanto mais gente, mais trocas! 🔥🎴\n\n\n_Copa 2026 · Família Tomelin_ 🏆`,
    `🌟 *FAMÍLIA TOMELIN CRESCENDO!* 🌟\n\n*${firstName}* acabou de se juntar ao nosso sistema de trocas! 🎉\n\nBem-vindo(a)! 🎴\n\n#FamíliaTomelin #Copa2026`,
    `🏆 *NOVO COLECIONADOR NA ÁREA!* 🏆\n\n👋 *${firstName}* entrou na Família Tomelin!\n\nBora completar o álbum juntos! 💪🎴\n\n\nFamília Tomelin · Copa 2026 ⚽`,
  ];

  const msg = templates[Math.floor(Math.random() * templates.length)];

  // Adiciona usuário ao DB local
  if (phone && !DB.users.find(u => u.phone === phone)) {
    DB.users.push({ phone, name, stickers: {}, ts: Date.now() });
    log('👤', 'Novo usuário: ' + name + ' (' + phone + ')');
  }

  const r = await sendGroup(msg);
  if (r.ok || r.messageId || r.zaapId) cronStats.enviados++;
  // Garante que ok está presente na resposta
  res.json({ ...r, ok: !!(r.ok || r.messageId || r.zaapId) });
});

// Health check
app.get('/health', (_, res) => res.json({
  status:   'online',
  postgres: !!process.env.DATABASE_URL,
  db_users: db.users.count(),
  users:    db.users.count(),
  market:   db.market.all().length,
  uptime:   Math.floor(process.uptime()),
  monitor:  monitorActive,
  ts:       new Date().toISOString(),
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
  if (r.ok || r.messageId || r.zaapId) cronStats.enviados++;
  // Garante que ok está presente na resposta
  res.json({ ...r, ok: !!(r.ok || r.messageId || r.zaapId) });
});

// Enviar mensagem privada
app.post('/api/send', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ ok: false, error: 'Campos phone e message obrigatórios' });
  try {
    const r = await sendPrivate(phone, message);
    res.json(r);
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Handle OPTIONS preflight for CORS
app.options('/api/send', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// Notificação de figurinha (chamado pelo app principal via fetch)
app.post('/api/notify-sticker', async (req, res) => {
  const { toPhone, toName, fromPhone, fromName, codes } = req.body;
  if (!toPhone || !fromPhone || !codes?.length)
    return res.status(400).json({ error: 'Campos toPhone, fromPhone e codes obrigatórios' });

  const pairKey = `${toPhone}:${[...codes].sort().join(',')}`;
  if (DB.notified.has(pairKey)) return res.json({ ok: true, skipped: true });
  DB.notified.add(pairKey);

  const codeList = codes.slice(0,5).join(', ') + (codes.length>5 ? ` +${codes.length-5} mais` : '');
  const nome = (toName||'').split(' ')[0] || 'amigo(a)';
  const msg = `🎴 Oi *${nome}*! Boa notícia! 🎉\n\n*${fromName || 'Um membro'}* tem ${codes.length>1?'figurinhas':'a figurinha'} que você precisa!\n\n🃏 *${codeList}*\n\nChama agora e combina a troca! 💨\n📱 *wa.me/55${fromPhone.replace(/\D/g,'')}*\n\nFamília Tomelin · Copa 2026 🏆🇧🇷`;
  const r = await sendPrivate(toPhone, msg);
  res.json(r);
});

// Sync usuários do app (o app envia o estado dos usuários)
app.post('/api/sync-users', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'Campo users deve ser um array' });
  const before = db.users.count();

  // Detectar novos usuários ou stickers alterados
  for (const u of users) {
    const existing = DB.users.find(x => x.phone === u.phone);
    if (!existing) {
      // Novo usuário — boas-vindas no grupo
      DB.users.push(u);
      const msg = `🎉 *Novo membro na Família Tomelin!*\n\n👋 Seja bem-vindo(a), *${u.name}*!\n\nAcesse o sistema e marque suas figurinhas:\n\nFamília Tomelin · Copa 2026 🏆`;
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

  res.json({ ok: true, before, after: db.users.count() });
});

// Sync mercado (quando alguém anuncia figurinha)
app.post('/api/sync-market', async (req, res) => {
  const { items, ownerPhone } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Campo items deve ser um array' });
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
        const msg = `🏷️ Oi *${toName}*! Tem figurinha pra você! 👀\n\n*${owner.name}* acabou de anunciar no mercado:\n\n🃏 *${codeList}*\n\nCorre antes que alguém pegue! 💨\n📱 *wa.me/55${owner.phone.replace(/\D/g,'')}*\n\nFamília Tomelin · Copa 2026 🏆`;
        await sendPrivate(u.phone, msg);
        await delay(800);
      }
    }
  }

  res.json({ ok: true, items: db.market.all().length });
});

// Jogos ao vivo
// Cache de jogos (atualizado pelo monitor a cada 2min)
let _jogosCache = { data: [], ts: 0 };

app.get('/api/jogos', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Retorna do cache se < 90s
  if (_jogosCache.data.length && Date.now() - _jogosCache.ts < 90000) {
    return res.json({ ok: true, matches: _jogosCache.data, cached: true, ts: _jogosCache.ts });
  }
  try {
    const matches = await fetchMatchesAPI();
    if (matches.length) {
      _jogosCache = { data: matches, ts: Date.now() };
    }
    res.json({ ok: true, matches: _jogosCache.data, cached: false, ts: _jogosCache.ts });
  } catch(e) {
    res.json({ ok: true, matches: _jogosCache.data, cached: true, ts: _jogosCache.ts, error: e.message });
  }
});

// Monitor on/off
app.post('/api/monitor', (req, res) => {
  monitorActive = Boolean(req.body.ativo);
  log('🔧', `Monitor: ${monitorActive ? 'ATIVO' : 'PAUSADO'}`);
  res.json({ monitorActive });
});

// Listar estado
app.get('/api/info', (_, res) => res.json({
  users: db.users.count(),
  market: db.market.all().length,
  monitorActive,
  cronStats: cronStats,
  lastScores: Object.keys(DB.lastScores).length,
}));

// Serve HTML
app.get('/', (_, res) => res.sendFile(pathMod.join(__dirname, 'index.html')));
app.get('/reset-db.html', (_, res) => res.sendFile(pathMod.join(__dirname, 'reset-db.html')));
app.get('/reset', (_, res) => res.sendFile(pathMod.join(__dirname, 'reset-db.html')));
app.get('/bot', (_, res) => res.sendFile(pathMod.join(__dirname, 'bot.html')));
app.get('/dashboard', (_, res) => res.sendFile(pathMod.join(__dirname, 'dashboard.html')));

// ── CRON JOBS AUTOMÁTICOS ─────────────────────────────────────

// 🌅 Curiosidade diária — todo dia às 9h BRT (12h UTC)
cron.schedule('0 12 * * *', async () => {
  log('⏰', 'Cron: curiosidade diária');
  const r = await sendGroup(getRandom(CURIOSIDADES));
  if (r.ok) cronStats.enviados++; else cronStats.erros++;
  cronStats.lastRun = new Date().toISOString();
}, { timezone: 'America/Sao_Paulo' });

// 🎴 Lembrete figurinhas — terça e quinta às 11h BRT
cron.schedule('0 11 * * 2,4', async () => {
  log('⏰', 'Cron: lembrete figurinhas');
  const r = await sendGroup(getRandom(MSGS_FIGURINHA));
  if (r.ok) cronStats.enviados++; else cronStats.erros++;
}, { timezone: 'America/Sao_Paulo' });

// 🔥 Hype fim de semana — sábado às 10h BRT
cron.schedule('0 10 * * 6', async () => {
  log('⏰', 'Cron: hype fim de semana');
  const r = await sendGroup(getRandom(MSGS_HYPE));
  if (r.ok) cronStats.enviados++; else cronStats.erros++;
}, { timezone: 'America/Sao_Paulo' });

// 🇧🇷 Jogo do Brasil — 13, 19, 25 jun às 13h BRT
['13 6','19 6','25 6'].forEach(d => {
  const [day, month] = d.split(' ');
  cron.schedule(`0 13 ${day} ${month} *`, async () => {
    log('🇧🇷', `Cron: Brasil joga hoje! (${day}/${month})`);
    const r = await sendGroup(getRandom(MSGS_BRASIL));
    if (r.ok) cronStats.enviados++; else cronStats.erros++;
  }, { timezone: 'America/Sao_Paulo' });
});

// ⚽ Monitor de jogos ao vivo — a cada 2 minutos
cron.schedule('*/2 * * * *', async () => {
  await monitorJogos();
}, { timezone: 'America/Sao_Paulo' });


// ── CRONS POR HORÁRIO ────────────────────────────────
// Bom dia: 8h seg-sex
cron.schedule('0 8 * * 1-5', async () => {
  log('☀️', 'Cron: bom dia');
  await sendGroup(getRandom(MSGS_MANHA));
}, { timezone: 'America/Sao_Paulo' });

// Boa tarde: 14h qui-sex
cron.schedule('0 14 * * 4,5', async () => {
  log('🌞', 'Cron: boa tarde');
  await sendGroup(getRandom(MSGS_TARDE));
}, { timezone: 'America/Sao_Paulo' });

// Boa noite: 21h dom
cron.schedule('0 21 * * 0', async () => {
  log('🌙', 'Cron: boa noite');
  await sendGroup(getRandom(MSGS_NOITE));
}, { timezone: 'America/Sao_Paulo' });

// Contagem regressiva: 17h ter-sex
cron.schedule('0 17 * * 2-5', async () => {
  log('⏳', 'Cron: contagem Copa');
  await sendGroup(getRandom(MSGS_CONTAGEM));
}, { timezone: 'America/Sao_Paulo' });

// ♻️ Limpa pares notificados a cada 6 horas (evita acúmulo de memória)
cron.schedule('0 */6 * * *', () => {
  const before = DB.notified.size;
  DB.notified.clear();
  log('♻️', `Cache de notificações limpo (${before} pares)`);
});

// ── START ────────────────────────────────────────────────────

// ── /s/:code — redirect encurtador ──────────────────────────
app.get('/s/:code', (req, res) => {
  const link = db.links.get(req.params.code);
  if (!link) return res.status(404).send('Link não encontrado');
  db.links.hit(req.params.code);
  res.redirect(302, link.url);
});
cron.schedule('0 * * * *', () => {
  db.newsSent.clean();
  // Limpa usuarios online inativos > 2min
  db.online.get();
  log('🧹', 'Limpeza horária: newsSent + online');
});

// ── Startup verification ─────────────────────────────────────
try {
  const testUser = db.users.upsert('_startup_test', {name:'test',passHash:'test',avatar:'⚽',stickers:{},ts:Date.now()});
  db.users.delete('_startup_test');
  log('✅', 'Banco de dados: OK');
} catch(e) {
  log('❌', 'Banco de dados ERROR: ' + e.message);
}

app.listen(PORT, '0.0.0.0', () => {
  log('🚀', `Servidor rodando na porta ${PORT}`);
  log('📱', `Z-API: ${ZAPI.instance}`);
  log('👥', `Grupo: ${ZAPI.groupId}`);
  log('🤖', 'Monitor de jogos: ATIVO');
  log('⏰', 'Cron jobs: ATIVOS');
  log('📡', `Endpoints Railway: ${db.users.count()} usuários | PG: ${!!process.env.DATABASE_URL}`);
});

module.exports = app;

// ═══════════════════════════════════════════════════════════════
// 📰 CACHE DE NOTÍCIAS + CLIMA — Atualiza a cada 5 min
// ═══════════════════════════════════════════════════════════════

const CACHE = {
  news:    { data: [], updatedAt: 0 },
  weather: { data: [], updatedAt: 0 },
  matches: { data: [], updatedAt: 0 },
};

const CACHE_TTL_NEWS    = 5  * 60 * 1000; // 5 min
const CACHE_TTL_WEATHER = 10 * 60 * 1000; // 10 min
const CACHE_TTL_MATCHES = 2  * 60 * 1000; // 2 min

// ── RSS parser simples (sem libs externas) ─────────────────────
function parseRSS(xml) {
  const items = [];
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const m of matches) {
    const itemStr = m[1];

    // Extract content (handles CDATA and plain)
    const get = (tag) => {
      const r = itemStr.match(new RegExp(
        '<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>|<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>'
      ));
      return r ? (r[1] || r[2] || '').trim() : '';
    };

    let title = get('title');
    let link  = '';
    // Limpa descrição: decodifica entidades ANTES de remover tags
    // (garante que &lt;a href=...&gt; também seja removido)
    const rawDesc = get('description') || '';
    const desc = rawDesc
      // 1ª passagem: decodifica entidades HTML para tags reais
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
      .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
      .replace(/&#\d+;/g,'')
      // 2ª passagem: remove TODOS os tags HTML (incluindo os decodificados)
      .replace(/<[^>]+>/g,'')
      // 3ª passagem: remove qualquer URL que sobrou (links do Google News etc)
      .replace(/https?:\/\/\S+/g,'')
      // Remove nome da fonte que às vezes vaza no final (ex: "...texto ge")
      .replace(/\s+[-–]?\s*[a-zA-ZÀ-ú]{1,20}\s*$/, '')
      // Limpa espaços extras
      .replace(/\s+/g,' ').trim()
      .substring(0, 220);
    const pub   = get('pubDate');
    const src   = (itemStr.match(/<source[^>]*>([^<]+)<\/source>/) || [])[1] || 'Copa 2026';

    // 1) Try <link>URL</link>
    const plainLink = get('link');
    if (plainLink && !plainLink.includes('news.google.com')) {
      link = plainLink;
    }

    // 2) Try <link href="URL"/> self-closing
    if (!link) {
      const hrefM = itemStr.match(/<link[^>]+href=["']([^"']+)["']/i);
      if (hrefM && !hrefM[1].includes('news.google.com')) link = hrefM[1];
    }

    // 3) Try <guid> — sometimes has the real URL
    if (!link) {
      const guid = get('guid');
      if (guid && guid.startsWith('http') && !guid.includes('news.google.com')) {
        link = guid;
      }
    }

    // 4) Try to extract real URL from Google News redirect link
    if (!link) {
      const googleLink = plainLink || get('guid') || '';
      if (googleLink.includes('news.google.com')) {
        // Convert /rss/articles/ to /articles/ — creates a valid GNews link
        link = googleLink.replace('/rss/articles/', '/articles/').replace(/\?.*$/, '') || '';
      }
    }

    // Clean title: remove ' - Source' suffix (Google RSS standard)
    title = title.replace(/\s+[-–]\s+[\w][^-–,]{1,35}$/, '').trim() || title;

    if (title) items.push({ title, link, desc, pub, src });
  }
  return items;
}

function fetchHTTPS(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'FamiliaTomelin/1.0', ...(opts.headers || {}) },
      timeout: opts.timeout || 8000,
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Busca e cacheia notícias ───────────────────────────────────
// Buscas no Google News (por tema)
const NEWS_QUERIES = [
  'Copa+do+Mundo+2026',
  'FIFA+World+Cup+2026+Brasil',
  'Sele%C3%A7%C3%A3o+Brasileira+2026',
  'Sele%C3%A7%C3%A3o+Brasileira+convocados',
  'CBF+sele%C3%A7%C3%A3o',
  'Brasil+futebol+hoje',
  'Neymar',
  'Vini+Jr',
  'Endrick',
  'amistoso+Brasil',
  'tabela+Copa+2026',
  'grupos+Copa+do+Mundo+2026',
  'Brasileir%C3%A3o+S%C3%A9rie+A',
  'Libertadores',
  'Santa+Catarina+futebol',
];

// Feeds RSS diretos de grandes portais (fonte fixa, conteúdo fresco)
const NEWS_FEEDS = [
  { url: 'https://ge.globo.com/futebol/rss/',                       src: 'GE Globo' },
  { url: 'https://ge.globo.com/futebol/selecao-brasileira/rss/',   src: 'GE Seleção' },
  { url: 'https://ge.globo.com/rss/',                              src: 'GE Globo' },
  { url: 'https://www.cnnbrasil.com.br/esportes/feed/',            src: 'CNN Brasil' },
  { url: 'https://www.lance.com.br/rss/',                          src: 'Lance!' },
  { url: 'https://www.terra.com.br/esportes/rss.xml',              src: 'Terra' },
  { url: 'https://www.nsctotal.com.br/feed',                       src: 'NSC Total' },
  { url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=pt-BR&gl=BR&ceid=BR:pt-419', src: 'Google Esportes' },
];

async function refreshNews() {
  const seen = new Set();
  const items = [];
  const LIMIT = 40;

  // 1) Feeds RSS diretos (prioridade — conteúdo mais fresco e variado)
  for (const feed of NEWS_FEEDS) {
    if (items.length >= LIMIT) break;
    try {
      const r = await fetchHTTPS(feed.url, { timeout: 8000 });
      if (r.status !== 200) continue;
      const parsed = parseRSS(r.body);
      for (const item of parsed) {
        if (!item.title || seen.has(item.title)) continue;
        seen.add(item.title);
        if (!item.src || item.src === 'Copa 2026') item.src = feed.src; // marca a fonte
        items.push(item);
        if (items.length >= LIMIT) break;
      }
    } catch (e) {
      log('⚠️', `Feed erro (${feed.src}): ${e.message}`);
    }
  }

  // 2) Google News por tema (complementa)
  for (const q of NEWS_QUERIES) {
    if (items.length >= LIMIT) break;
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const r = await fetchHTTPS(rssUrl, { timeout: 8000 });
      if (r.status !== 200) continue;
      const parsed = parseRSS(r.body);
      for (const item of parsed) {
        if (!item.title || seen.has(item.title)) continue;
        seen.add(item.title);
        items.push(item);
        if (items.length >= LIMIT) break;
      }
    } catch (e) {
      log('⚠️', `News RSS erro (${q}): ${e.message}`);
    }
  }

  if (items.length > 0) {
    db.news.set(items);
    log('📰', `Cache atualizado — ${items.length} itens (${NEWS_FEEDS.length} feeds + ${NEWS_QUERIES.length} buscas)`);
  } else {
    log('⚠️', 'Nenhuma notícia encontrada, mantendo cache anterior');
  }
  return db.news.get();
}

// ── Busca e cacheia clima (Open-Meteo) ────────────────────────
const CIDADES = [
  { name: 'Blumenau',   lat: -26.9195, lon: -49.0661, emoji: '🏙️' },
  { name: 'Pomerode',   lat: -26.7440, lon: -49.1773, emoji: '🌸' },
  { name: 'Timbó',      lat: -26.8219, lon: -49.2714, emoji: '🌿' },
  { name: 'Indaial',    lat: -26.8983, lon: -49.2322, emoji: '🏞️' },
  { name: 'Gaspar',     lat: -26.9308, lon: -48.9589, emoji: '🌾' },
  { name: 'Ascurra',    lat: -26.7922, lon: -49.3158, emoji: '🌲' },
  { name: 'Rio do Sul', lat: -27.2136, lon: -49.6417, emoji: '🏔️' },
];

const WMO = {
  0:'Céu limpo',1:'Poucas nuvens',2:'Parcialmente nublado',3:'Nublado',
  45:'Névoa',48:'Névoa',51:'Garoa leve',53:'Garoa',55:'Garoa forte',
  61:'Chuva leve',63:'Chuva moderada',65:'Chuva forte',
  71:'Neve leve',73:'Neve',75:'Neve forte',
  80:'Pancadas leves',81:'Pancadas',82:'Pancadas fortes',
  95:'Tempestade',96:'Tempestade c/ granizo',99:'Tempestade forte',
};
const WMO_ICON = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',
  80:'🌦️',81:'🌦️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️',
};

async function refreshWeather() {
  try {
    const lats = CIDADES.map(c => c.lat).join(',');
    const lons  = CIDADES.map(c => c.lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,precipitation&timezone=America%2FSao_Paulo&forecast_days=1`;
    const r = await fetchHTTPS(url, { timeout: 10000 });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const raw = JSON.parse(r.body);
    const arr  = Array.isArray(raw) ? raw : [raw];
    const result = arr.map((d, i) => {
      const c   = CIDADES[i] || { name: '?', emoji: '🌍' };
      const cur = d.current || {};
      const code = cur.weather_code ?? 0;
      return {
        city:  c.name,
        emoji: c.emoji,
        temp:  Math.round(cur.temperature_2m ?? 0),
        hum:   Math.round(cur.relative_humidity_2m ?? 0),
        wind:  Math.round(cur.wind_speed_10m ?? 0),
        prec:  cur.precipitation ?? 0,
        code,
        icon:  WMO_ICON[code] || '🌡️',
        desc:  WMO[code] || 'Variável',
      };
    });
    CACHE.weather.data      = result;
    CACHE.weather.updatedAt = Date.now();
    log('🌤️', `Clima atualizado — ${result.length} cidades`);
    return result;
  } catch (e) {
    log('⚠️', `Clima erro: ${e.message}`);
    return CACHE.weather.data;
  }
}

// ── Rotas de cache ─────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const age = Date.now() - db.news.ts();
  if (!db.news.get().length || age > CACHE_TTL_NEWS) {
    await refreshNews();
  }
  res.json({
    ok: true,
    updatedAt: db.news.ts(),
    ageSeconds: Math.floor((Date.now() - db.news.ts()) / 1000),
    items: db.news.get(),
  });
});

app.get('/api/weather', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const age = Date.now() - CACHE.weather.updatedAt;
  if (!CACHE.weather.data.length || age > CACHE_TTL_WEATHER) {
    await refreshWeather();
  }
  res.json({
    ok: true,
    updatedAt: CACHE.weather.updatedAt,
    ageSeconds: Math.floor((Date.now() - CACHE.weather.updatedAt) / 1000),
    cities: CACHE.weather.data,
  });
});

// ── CRON: atualiza automaticamente ────────────────────────────
// Notícias: a cada 5 minutos
cron.schedule('*/5 * * * *', async () => {
  await refreshNews();
}, { timezone: 'America/Sao_Paulo' });

// Clima: a cada 10 minutos
cron.schedule('*/10 * * * *', async () => {
  await refreshWeather();
}, { timezone: 'America/Sao_Paulo' });

// ── Inicializa cache ao subir o server ────────────────────────
(async () => {
  log('📰', 'Carregando notícias iniciais...');
  await refreshNews();
  log('🌤️', 'Carregando clima inicial...');
  await refreshWeather();
})();



// ══════════════════════════════════════════════════════════════
// 🔗 ENCURTADOR DE URLs — copa2026.familiatomelin.com.br/s/:code
// Armazena em memória + arquivo JSON para persistência
// ══════════════════════════════════════════════════════════════
// Links gerenciados por db.js e api.js

// ═══════════════════════════════════════════════════════════════
// 📰 RPA DE NOTÍCIAS — Puxa e envia notícias ao vivo a cada 10min
// ═══════════════════════════════════════════════════════════════

// ── News Sent — persistido em disco para sobreviver restarts ────
const NEWS_SENT_FILE = pathMod.join(__dirname, 'data', 'news_sent.json');
const NEWS_SENT = new Set();
let newsRpaEnabled = true;
let newsRpaCount = 0;

// // newsSent loaded automatically by db { — moved to db.js/api.js


// // newsSent saved automatically by db { — moved to db.js/api.js


// newsSent loaded automatically by db;

// Formata notícia para WhatsApp
function formatNewsMsg(item, idx) {
  const emojis = ['📰','⚽','🏆','🌎','🔥','🎯','💥','📡','🗞️','⚡','🔴','📺'];
  const ico = emojis[idx % emojis.length];

  // Título limpo (remove " - Fonte" do final)
  const title = ((item.title || '')
    .replace(/\s+[-–]\s+[\w][^-–,]{1,40}$/, '').trim()
    || (item.title || '')).trim();

  const src = item.src || 'Copa 2026';

  // Resumo: limpa entidades + tags, mantém o texto
  let desc = (item.desc || '')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .replace(/&#\d+;/g,'').replace(/<[^>]+>/g,'')
    .replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim();

  // Remove título duplicado no início do resumo
  if (desc.toLowerCase().startsWith(title.toLowerCase().substring(0, 25))) {
    desc = desc.substring(title.length).replace(/^[\s\-–·|]+/, '').trim();
  }
  // Resumo até 220 chars, corta na última frase/palavra completa
  if (desc.length > 220) {
    desc = desc.substring(0, 220);
    const lastDot = desc.lastIndexOf('. ');
    if (lastDot > 100) desc = desc.substring(0, lastDot + 1);
    else desc = desc.substring(0, desc.lastIndexOf(' ')) + '…';
  }
  if (desc.length < 20 || desc.toLowerCase() === title.toLowerCase()) desc = '';

  // Link: encurta no próprio domínio (copa2026.familiatomelin.com.br/s/xxx)
  let linkLine = '';
  if (item.link && item.link.length > 10 && !/news\.google\.com/.test(item.link)) {
    try {
      const short = db.shorten(item.link, 'copa2026.familiatomelin.com.br');
      const display = short.replace(/^https?:\/\//, '');
      linkLine = `\n🔗 ${display}`;
    } catch(e) { /* sem link se falhar */ }
  }

  const lines = [
    `${ico} *${src.toUpperCase()}*`,
    '',
    `*${title}*`,
  ];
  if (desc) { lines.push(''); lines.push(desc); }
  lines.push('');
  lines.push(`🔗 Leia: ${linkLine ? linkLine.replace('\n🔗 ','') : 'copa2026.familiatomelin.com.br'}`);
  lines.push(`_Família Tomelin · Copa 2026_ 🏆`);

  return lines.join('\n');
}


// Gera ID único para notícia — só título normalizado
// (pub date varia entre fetches do Google News, causando reenvio)
function newsId(item) {
  return (item.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')   // remove pontuação e espaços
    .substring(0, 60);            // primeiros 60 chars são suficientes
}

// RPA principal: puxa notícias frescas e envia as novas no grupo
let _lastRpaSend = 0; // timestamp do último envio

const NEWS_PER_CYCLE = 3;
const NEWS_MIN_INTERVAL = 4 * 60 * 1000;
const NEWS_MAX_AGE_MS = 72 * 60 * 60 * 1000;

async function rpaNewsLoop() {
  if (!newsRpaEnabled) return;
  if (Date.now() - _lastRpaSend < NEWS_MIN_INTERVAL) return;

  try {
    const items = await refreshNews();
    if (!items || !items.length) { log('📰', 'RPA: sem noticias disponiveis'); return; }

    const novas = items.filter(it => {
      const id = newsId(it);
      if (db.newsSent.has(id)) return false;
      if (it.pub) {
        const ageMs = Date.now() - new Date(it.pub).getTime();
        if (ageMs > NEWS_MAX_AGE_MS) return false;
      }
      return true;
    });

    if (!novas.length) { log('📰', `RPA: ${db.raw().newsSent.length} enviadas, sem novas nas ultimas 72h`); return; }

    const ordenadas = novas.sort((a, b) => new Date(b.pub||0) - new Date(a.pub||0));
    const lote = ordenadas.slice(0, NEWS_PER_CYCLE);
    log('📰', `RPA: enviando lote de ${lote.length} noticia(s)`);

    let enviadas = 0;
    for (const item of lote) {
      const id = newsId(item);
      const msg = formatNewsMsg(item, newsRpaCount);
      const r = await sendGroup(msg);
      if (r.ok) {
        db.newsSent.add(id); newsRpaCount++; enviadas++; cronStats.enviados++;
        log('✅', `RPA: #${newsRpaCount} — "${(item.title||'').substring(0,45)}"`);
      } else {
        log('❌', `RPA: falha — ${JSON.stringify(r).substring(0,80)}`); cronStats.erros++;
      }
      await delay(2000);
    }
    if (enviadas > 0) _lastRpaSend = Date.now();

  } catch (e) {
    log('❌', `RPA news erro: ${e.message}`); cronStats.erros++;
  }
}

// Limpa histórico de enviados a cada 6h (recicla notícias antigas)
cron.schedule('0 */4 * * *', () => {
  const before = db.raw().newsSent.length;
  db.newsSent.clear();
  log('♻️', `RPA: cache de noticias limpo (${before} itens) — permite reenvio`);
}, { timezone: 'America/Sao_Paulo' });

// Cron: roda a cada 10 minutos
cron.schedule('*/5 * * * *', async () => {
  log('⏰', 'RPA cron: buscando noticias (lote de 3)...');
  await rpaNewsLoop();
}, { timezone: 'America/Sao_Paulo' });

// ── Rotas de controle do RPA ──────────────────────────────────
app.get('/api/rpa/status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    ok: true,
    enabled: newsRpaEnabled,
    sent: newsRpaCount,
    queued: db.raw().newsSent.length,
    lastNews: db.news.ts() ? new Date(db.news.ts()).toISOString() : null,
    newsCount: db.news.get().length,
    lastSend: _lastRpaSend ? new Date(_lastRpaSend).toISOString() : null,
    nextSend: _lastRpaSend ? new Date(_lastRpaSend + 55*60*1000).toISOString() : null,
  });
});

app.post('/api/rpa/toggle', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  newsRpaEnabled = !newsRpaEnabled;
  log('⚙️', `RPA notícias ${newsRpaEnabled ? 'ATIVADO' : 'DESATIVADO'}`);
  res.json({ ok: true, enabled: newsRpaEnabled });
});

app.all('/api/rpa/run-now', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  log('▶️', 'RPA: execucao manual (diagnostico)');
  const diag = { steps: [] };
  try {
    // 1) Buscar notícias
    const items = await refreshNews();
    diag.steps.push(`1) refreshNews retornou ${items.length} itens`);
    diag.totalCache = items.length;

    if (!items.length) {
      diag.steps.push('❌ PAROU: nenhuma notícia no cache (feeds falharam?)');
      return res.json({ ok: false, diag });
    }

    // 2) Filtrar novas (não enviadas + últimas 72h)
    const jaEnviadas = db.raw().newsSent.length;
    const novas = items.filter(it => {
      const id = newsId(it);
      if (db.newsSent.has(id)) return false;
      if (it.pub) {
        const ageMs = Date.now() - new Date(it.pub).getTime();
        if (ageMs > NEWS_MAX_AGE_MS) return false;
      }
      return true;
    });
    diag.steps.push(`2) ${jaEnviadas} já enviadas; ${novas.length} novas elegíveis (72h)`);
    diag.jaEnviadas = jaEnviadas;
    diag.novas = novas.length;
    diag.amostra = items.slice(0, 5).map(it => ({
      title: (it.title||'').substring(0, 60),
      src: it.src,
      pub: it.pub || 'sem data',
      ageH: it.pub ? Math.round((Date.now()-new Date(it.pub).getTime())/3600000) : null,
    }));

    if (!novas.length) {
      diag.steps.push('⚠️ Sem notícias novas — limpando cache de enviadas para reenviar');
      db.newsSent.clear();
      diag.steps.push('✅ Cache de enviadas limpo, tente novamente');
      return res.json({ ok: false, diag });
    }

    // 3) Testar envio da primeira
    const item = novas.sort((a,b)=>new Date(b.pub||0)-new Date(a.pub||0))[0];
    diag.steps.push(`3) Enviando: "${(item.title||'').substring(0,50)}" (${item.src})`);
    const msg = formatNewsMsg(item, newsRpaCount);
    const r = await sendGroup(msg);
    diag.sendResult = r;

    if (r.ok) {
      db.newsSent.add(newsId(item));
      newsRpaCount++;
      _lastRpaSend = 0; // permite o cron continuar enviando o resto
      diag.steps.push(`✅ ENVIADO! messageId: ${r.messageId}`);
      // Dispara o resto do lote em background
      rpaNewsLoop().catch(e => log('❌', e.message));
    } else {
      diag.steps.push(`❌ FALHA no envio: ${JSON.stringify(r.error).substring(0,200)}`);
      diag.steps.push('→ Problema na Z-API (credenciais/grupo/instância)');
    }

    res.json({ ok: r.ok, diag });
  } catch(e) {
    diag.steps.push(`❌ ERRO: ${e.message}`);
    res.json({ ok: false, diag, error: e.message });
  }
});



// Estado gerenciado por db.js e api.js


// ═══════════════════════════════════════════════════════════════
// 🎯 MENSAGENS DE CONVITE — Chama amigos para o sistema
// ═══════════════════════════════════════════════════════════════

const INVITE_MSGS = [
  () => `🎴 *VOCÊ AINDA NÃO TEM O SISTEMA?*

Aqui a galera da Família Tomelin está completando o álbum da Copa 2026 juntos!

✅ Marque suas figurinhas
🔄 Veja quem tem o que você precisa
🏷️ Anuncie suas repetidas
⚽ Acompanhe jogos ao vivo

👉 copa2026.familiatomelin.com.br
Família Tomelin · Copa 2026 🏆`,

  () => `⚽ *FAMÍLIA TOMELIN — COPA 2026* 🏆

O sistema de trocas de figurinhas Panini está esperando por você!

📱 Acesse, cadastre-se e comece a trocar:
copa2026.familiatomelin.com.br

980 figurinhas · 48 seleções · troca automática
Família Tomelin · Copa 2026 🏆`,

  () => `🎴 *DICA DE OURO PRA COMPLETAR O ÁLBUM!*

Chega de sair procurando figurinhas por aí — o sistema cruza automaticamente quem tem o que você precisa!

Só entrar, marcar suas figurinhas e ver os matches 🔄

copa2026.familiatomelin.com.br
Família Tomelin · Copa 2026 🏆`,

  () => `🏆 *COPA 2026 — 48 SELEÇÕES · 980 FIGURINHAS*

O álbum Panini tá chegando e a Família Tomelin já tá organizando as trocas!

Entre no sistema, cadastre suas figurinhas e troque com a galera:
copa2026.familiatomelin.com.br

_Gratuito · Rápido · Fácil_ 🎴
Família Tomelin · Copa 2026 🏆`,

  () => `📣 *CHAMA OS AMIGOS PRO SISTEMA!*

Mais gente = mais chances de completar seu álbum!

O sistema da Família Tomelin já tem membros cadastrando figurinhas. Quanto mais, melhor! 🔄

Entra lá:
copa2026.familiatomelin.com.br
Família Tomelin · Copa 2026 🏆`,
];

let _lastInvite = 0;

async function sendInviteMsg(idx) {
  const msg = typeof INVITE_MSGS[idx] === 'function'
    ? INVITE_MSGS[idx]()
    : INVITE_MSGS[0]();
  const r = await sendGroup(msg);
  if (r.ok) {
    _lastInvite = Date.now();
    log('📣', 'Mensagem de convite enviada #' + idx);
    cronStats.enviados++;
  }
  return r;
}

// ── Endpoint: POST /api/invite ───────────────────────────────

// ═══════════════════════════════════════════════════════════════
// 👤 AUTENTICAÇÃO CROSS-DEVICE — salva e verifica no Railway
// Permite que o mesmo usuário faça login em qualquer celular
// ═══════════════════════════════════════════════════════════════

// DB de usuários persistente
const USERS_FILE = pathMod.join(__dirname, 'data', 'users.json');
let DB_USERS = []; // { phone, name, passHash, avatar, stickers, ts }

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      DB_USERS = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      log('👤', `Usuários carregados: ${DB_USERS.length}`);
    }
  } catch(e) { log('⚠️', 'loadUsers: ' + e.message); }
}

function saveUsers() {
  try {
    fs.mkdirSync(pathMod.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(DB_USERS, null, 2));
  } catch(e) { log('⚠️', 'saveUsers: ' + e.message); }
}

loadUsers();

// ── POST /api/auth/register ──────────────────────────────────
// Registra ou atualiza usuário no Railway
// /api/auth/register handled by api.js
;

// ── /api/auth/* → Handled entirely by api.js router ──────────


function sanitizeUser(u) {
  // Nunca enviar passHash para o cliente
  const { passHash, ...safe } = u;
  return safe;
}


app.post('/api/invite', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { idx = 0 } = req.body || {};
  try {
    const r = await sendInviteMsg(Math.min(Number(idx), INVITE_MSGS.length - 1));
    res.json({ ok: r.ok, sent: true, idx, total: INVITE_MSGS.length });
  } catch(e) {
    log('❌', 'Erro invite: ' + e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ── Endpoint: GET /api/invite/list ──────────────────────────
app.get('/api/invite/list', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    ok: true,
    total: INVITE_MSGS.length,
    lastSent: _lastInvite ? new Date(_lastInvite).toISOString() : null,
    messages: INVITE_MSGS.map((fn, i) => ({
      idx: i,
      preview: fn().substring(0, 80) + '...'
    }))
  });
});

log('📣', 'Sistema de convites inicializado — ' + INVITE_MSGS.length + ' mensagens disponíveis');

log('📰', 'RPA de notícias iniciado — envia a cada 10 minutos');

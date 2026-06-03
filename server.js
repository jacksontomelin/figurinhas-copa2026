// ═══════════════════════════════════════════════════════════════
// 🤖 FAMÍLIA TOMELIN — Bot Z-API Totalmente Automatizado
// Railway Deploy | node server.js
// ═══════════════════════════════════════════════════════════════

'use strict';
const express = require('express');

const https   = require('https');
const cron    = require('node-cron');
const pathMod = require('path');
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
  `⚽ *SABIA DISSO? — COPA 2026*\n\nA Copa 2026 vai ter *48 seleções* pela 1ª vez na história!\nSão *104 jogos* em *16 estádios* em 3 países! 🌎\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🇧🇷 *SABIA DISSO? — COPA 2026*\n\nO Brasil é o ÚNICO país a disputar TODAS as 23 edições da Copa!\nSomos únicos! 💛💚🏆\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🏟️ *SABIA DISSO? — COPA 2026*\n\nO Estadio Azteca no México vai sediar sua *3ª Copa do Mundo* (1970, 1986 e 2026)! Único estádio do mundo com essa marca! 🎉\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `⭐ *SABIA DISSO? — COPA 2026*\n\nO *MetLife Stadium* em Nova York recebe a *FINAL* em 19 de julho!\nO Brasil também joga lá na fase de grupos! 🇧🇷🏟️\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🎴 *SABIA DISSO? — PANINI*\n\nPara completar o álbum com sorte média você precisaria de cerca de *196 pacotinhos*!\nPor isso troque figurinhas com o grupo! 😄🔄\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🏆 *SABIA DISSO? — COPA 2026*\n\nA premiação total da Copa 2026 é de *US$ 1 bilhão*!\nO campeão leva US$ 200 milhões! 💰⚽\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🥅 *SABIA DISSO? — COPA 2026*\n\nMiroslav Klose (Alemanha) é o maior artilheiro da história das Copas com *16 gols*!\nSerá que alguém vai superar? 👀⚽\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `💡 *SABIA DISSO? — PANINI*\n\nA Panini produz figurinhas de Copa desde *1970*, no México!\nO mesmo lugar onde a Copa 2026 vai começar! 🎴🌎\n\n_Família Tomelin · Copa 2026_ 🏆`,
];

const MSGS_FIGURINHA = [
  `🎴 *ATENÇÃO — TROCAS DE FIGURINHAS!*\n\nJá marcou suas figurinhas no sistema? 📱\n\n✅ Veja o que falta no álbum\n⭐ Anuncie suas repetidas\n🔄 Troque com outros membros\n💬 Chat interno para combinar\n\n\n*Bora completar o álbum!* 🏆🎴`,
  `📦 *LEMBRETE — FIGURINHAS!*\n\nVocê tem figurinhas *repetidas* guardadas sem usar? 😅\n\nNo nosso sistema você anuncia e troca com outros membros do grupo sem sair do WhatsApp!\n\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🔄 *HORA DE TROCAR FIGURINHAS!*\n\nNossa plataforma cruza automaticamente quem tem as figuras que faltam pra você!\n\nÉ só marcar as suas repetidas que o sistema já te mostra quem chamar! 🤝\n\n\n_Família Tomelin · Copa 2026_ 🏆`,
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
  `☀️ *BOM DIA, FAMÍLIA TOMELIN!* ⚽\n\nHoje é mais um dia de completar o álbum da Copa 2026! 🎴\nVeja quem tem as figurinhas que você precisa no sistema!\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🌅 *BOM DIA!* ⚽\n\nA Copa 2026 está chegando! Ainda tem figurinhas pra trocar?\nAcesse o sistema e veja as trocas disponíveis! 🎴🔄\n\n_Família Tomelin · Copa 2026_`,
];

const MSGS_TARDE = [
  `🌞 *BOA TARDE, FAMÍLIA TOMELIN!* ⚽\n\nComo está seu álbum? Já marcou todas as figurinhas de hoje? 🎴\nO sistema está esperando por você!\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `⚽ *BOA TARDE!*\n\nAproveitou para trocar figurinhas hoje? 🎴\nO sistema da Família Tomelin cruzou novos matches pra você!\n\n_Família Tomelin · Copa 2026_`,
];

const MSGS_NOITE = [
  `🌙 *BOA NOITE, FAMÍLIA TOMELIN!* ⚽\n\nFim de dia — como foi a caçada às figurinhas? 🎴\nAmanhã tem mais! Copa 2026 chegando! 🏆\n\n_Família Tomelin · Copa 2026_`,
  `⭐ *BOA NOITE!*\n\nAntes de dormir... dá uma olhada no álbum? 😄🎴\nTem matches novos esperando por você no sistema!\n\n_Família Tomelin · Copa 2026_ 🏆`,
];

const MSGS_CONTAGEM = [
  `⏳ *FALTAM POUCOS DIAS PARA A COPA 2026!* 🏆\n\n⚽ 48 seleções\n🌎 3 países\n🏟️ 16 estádios\n🎴 980 figurinhas\n\nSeu álbum está pronto? 💪\n\n_Família Tomelin · Copa 2026_`,
  `🔥 *A COPA 2026 TÁ AÍ!* ⚽\n\nEUA · Canadá · México vão receber o maior espetáculo do futebol!\n🇧🇷 E o Brasil vai em busca do HEXA! 🏆\n\n_Família Tomelin · Copa 2026_`,
  `🎴 *FIQUE LIGADO — COPA 2026!* 📅\n\nO álbum Panini tem *980 figurinhas* de 48 seleções!\nVocê já tem quantas? Veja no sistema e troque com a galera! 🔄\n\n_Família Tomelin · Copa 2026_ 🏆`,
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

    const msg = `🎴 Oi *${toName}*! Boa notícia! 🎉\n\n*${fromName}* tem ${need.length > 1 ? 'figurinhas' : 'uma figurinha'} que você precisa!\n\n🃏 *${codeList}*\n\nChama agora e combina a troca antes que alguém pegue! 💨\n📱 *wa.me/55${owner.phone.replace(/\D/g,'')}*\n\n_Família Tomelin · Copa 2026_ 🏆🇧🇷`;

    await sendPrivate(u.phone, msg);
    await delay(800);
  }
}

// ── MIDDLEWARES ───────────────────────────────────────────────
app.use(require('express').json());
app.use(require('express').static(pathMod.join(__dirname)));
// CORS global
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── ROTAS ─────────────────────────────────────────────────────


// Notificação de novo usuário cadastrado
app.post('/api/new-user', async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name obrigatório' });

  const firstName = name.split(' ')[0];
  const templates = [
    `🎉 *NOVO MEMBRO NA FAMÍLIA TOMELIN!* 🎉\n\n👋 Bem-vindo(a), *${firstName}*! Que bom ter você aqui!\n\nAgora é só marcar suas figurinhas e trocar com a galera! 🎴🔄\n\n\n_Família Tomelin · Copa 2026_ 🏆⚽`,
    `🎴 *${firstName} ENTROU NO SISTEMA!* 🎉\n\nBoa notícia! *${firstName}* acaba de se cadastrar no sistema de trocas da Família Tomelin! 👏\n\nBem-vindo(a)! 🇧🇷🏆\n`,
    `⚽ *CHEGOU MAIS UM NA FAMÍLIA TOMELIN!* ⚽\n\n🙌 *${firstName}* acabou de entrar no sistema!\n\nQuanto mais gente, mais trocas! 🔥🎴\n\n\n_Copa 2026 · Família Tomelin_ 🏆`,
    `🌟 *FAMÍLIA TOMELIN CRESCENDO!* 🌟\n\n*${firstName}* acabou de se juntar ao nosso sistema de trocas! 🎉\n\nBem-vindo(a)! 🎴\n\n#FamíliaTomelin #Copa2026`,
    `🏆 *NOVO COLECIONADOR NA ÁREA!* 🏆\n\n👋 *${firstName}* entrou na Família Tomelin!\n\nBora completar o álbum juntos! 💪🎴\n\n\n_Família Tomelin · Copa 2026_ ⚽`,
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ ok: false, error: 'phone e message obrigatórios' });
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
      const msg = `🎉 *Novo membro na Família Tomelin!*\n\n👋 Seja bem-vindo(a), *${u.name}*!\n\nAcesse o sistema e marque suas figurinhas:\n\n_Família Tomelin · Copa 2026_ 🏆`;
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
app.listen(PORT, () => {
  log('🚀', `Servidor rodando na porta ${PORT}`);
  log('📱', `Z-API: ${ZAPI.instance}`);
  log('👥', `Grupo: ${ZAPI.groupId}`);
  log('🤖', 'Monitor de jogos: ATIVO');
  log('⏰', 'Cron jobs: ATIVOS');
  log('📡', 'Endpoints: /health /api/status /api/send-group /api/sync-users /api/sync-market');
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
    // Strip HTML, decode entities, clean whitespace
    const rawDesc = get('description') || '';
    const desc = rawDesc
      .replace(/<[^>]+>/g, '')          // remove all HTML tags
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
      .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
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
async function refreshNews() {
  const queries = [
    'Copa+do+Mundo+2026',
    'FIFA+World+Cup+2026+Brasil',
    'Sele%C3%A7%C3%A3o+Brasileira+2026',
  ];
  const seen = new Set();
  const items = [];

  for (const q of queries) {
    if (items.length >= 12) break;
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const r = await fetchHTTPS(rssUrl, { timeout: 8000 });
      if (r.status !== 200) continue;
      const parsed = parseRSS(r.body);
      for (const item of parsed) {
        if (!seen.has(item.title)) {
          seen.add(item.title);
          items.push(item);
          if (items.length >= 12) break;
        }
      }
    } catch (e) {
      log('⚠️', `News RSS erro (${q}): ${e.message}`);
    }
  }

  if (items.length > 0) {
    CACHE.news.data      = items;
    CACHE.news.updatedAt = Date.now();
    log('📰', `Cache de notícias atualizado — ${items.length} itens`);
  } else {
    log('⚠️', 'Nenhuma notícia encontrada, mantendo cache anterior');
  }
  return CACHE.news.data;
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
  const age = Date.now() - CACHE.news.updatedAt;
  if (!CACHE.news.data.length || age > CACHE_TTL_NEWS) {
    await refreshNews();
  }
  res.json({
    ok: true,
    updatedAt: CACHE.news.updatedAt,
    ageSeconds: Math.floor((Date.now() - CACHE.news.updatedAt) / 1000),
    items: CACHE.news.data,
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
const LINKS_FILE = pathMod.join(__dirname, 'data', 'links.json');
let shortLinks = {}; // code → { url, created, hits }

// Carrega links salvos ao iniciar
function loadLinks() {
  try {
    if (fs.existsSync(LINKS_FILE)) {
      shortLinks = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
      log('🔗', `Encurtador: ${Object.keys(shortLinks).length} links carregados`);
    }
  } catch (e) { log('⚠️', 'loadLinks: ' + e.message); }
}

function saveLinks() {
  try {
    fs.mkdirSync(pathMod.dirname(LINKS_FILE), { recursive: true });
    fs.writeFileSync(LINKS_FILE, JSON.stringify(shortLinks, null, 2));
  } catch (e) { log('⚠️', 'saveLinks: ' + e.message); }
}

// Gera código único de 6 chars
function genCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (shortLinks[code]);
  return code;
}

// Cache: url original → code (evita duplicar)
const urlToCode = new Map();

function shortenUrl(url) {
  if (!url || url.length < 20) return url;
  // Check cache
  if (urlToCode.has(url)) {
    return `${APP_URL}/s/${urlToCode.get(url)}`;
  }
  // Check existing links
  const existing = Object.entries(shortLinks).find(([, v]) => v.url === url);
  if (existing) {
    urlToCode.set(url, existing[0]);
    return `${APP_URL}/s/${existing[0]}`;
  }
  // Create new
  const code = genCode();
  shortLinks[code] = { url, created: Date.now(), hits: 0 };
  urlToCode.set(url, code);
  saveLinks();
  log('🔗', `Novo link: /s/${code} → ${url.substring(0, 60)}`);
  return `${APP_URL}/s/${code}`;
}

// ── Redirect endpoint: GET /s/:code ──────────────────────────
app.get('/s/:code', (req, res) => {
  const { code } = req.params;
  const link = shortLinks[code];
  if (!link) {
    return res.status(404).send('<h2>Link não encontrado</h2><p><a href="/">Voltar</a></p>');
  }
  link.hits = (link.hits || 0) + 1;
  saveLinks();
  res.redirect(302, link.url);
});

// ── API: POST /api/shorten ─────────────────────────────────────
app.post('/api/shorten', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = req.body?.url || req.query.url;
  if (!url) return res.json({ ok: false, error: 'url required' });
  const short = shortenUrl(url);
  res.json({ ok: true, short, original: url });
});

// ── API: GET /api/shorten (conveniência) ─────────────────────
app.get('/api/shorten', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { url } = req.query;
  if (!url) return res.json({ ok: false, error: 'url required' });
  const short = shortenUrl(url);
  res.json({ ok: true, short, original: url });
});

// ── API: GET /api/links (lista todos) ────────────────────────
app.get('/api/links', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const list = Object.entries(shortLinks).map(([code, v]) => ({
    code,
    short: `${APP_URL}/s/${code}`,
    url: v.url,
    hits: v.hits || 0,
    created: v.created,
  })).sort((a, b) => b.hits - a.hits);
  res.json({ ok: true, count: list.length, links: list });
});

loadLinks();

// ═══════════════════════════════════════════════════════════════
// 📰 RPA DE NOTÍCIAS — Puxa e envia notícias ao vivo a cada 10min
// ═══════════════════════════════════════════════════════════════

const NEWS_SENT = new Set(); // IDs de notícias já enviadas (evita repetição)
let newsRpaEnabled = true;
let newsRpaCount = 0;

// Formata notícia para WhatsApp
function formatNewsMsg(item, idx) {
  const emojis = ['📰','⚽','🏆','🌎','🔥','🎯','💥','📡','🗞️','⚡','🔴','📺'];
  const ico = emojis[idx % emojis.length];

  // Título limpo (remove " - Fonte" no final)
  const title = (item.title || '')
    .replace(/\s+[-–]\s+[\w][^-–,]{1,40}$/, '').trim()
    || (item.title || '');

  const src  = item.src || 'Copa 2026';

  // Desc: já vem limpa do parseRSS (sem HTML)
  const desc = (item.desc || '').substring(0, 200).trim();

  // Link encurtado
  let linkLine = '';
  if (item.link && item.link.length > 10) {
    const short = shortenUrl(item.link);
    linkLine = `\n🔗 ${short}`;
  }

  const msg = [
    `${ico} *COPA 2026 — NOTÍCIA*`,
    ``,
    `*${title}*`,
    desc ? desc : null,
    ``,
    `📰 _${src}_${linkLine}`,
    `_Família Tomelin · Copa 2026_ 🏆`,
  ].filter(l => l !== null).join('\n');

  return msg;
}

// Gera ID único para notícia (evitar reenvio)
function newsId(item) {
  return (item.title || '').substring(0, 60).replace(/\s+/g, '_').toLowerCase();
}

// RPA principal: puxa notícias e envia as novas no grupo
async function rpaNewsLoop() {
  if (!newsRpaEnabled) return;

  try {
    // Atualiza cache de notícias
    const items = await refreshNews();
    if (!items || !items.length) {
      log('📰', 'RPA: sem notícias no cache');
      return;
    }

    // Filtra notícias NÃO enviadas ainda
    const novas = items.filter(it => !NEWS_SENT.has(newsId(it)));

    if (!novas.length) {
      log('📰', `RPA: todas as ${items.length} notícias já foram enviadas`);
      return;
    }

    // Envia apenas 1 notícia por vez (a mais recente não enviada)
    const item = novas[0];
    const id   = newsId(item);

    log('📰', `RPA: enviando notícia — "${(item.title||'').substring(0,50)}"`);

    const msg = formatNewsMsg(item, newsRpaCount);
    const r   = await sendGroup(msg);

    if (r.ok) {
      NEWS_SENT.add(id);
      newsRpaCount++;
      log('✅', `RPA: notícia enviada (#${newsRpaCount})`);
      if (r.messageId) DB.cronStats.sent++;
    } else {
      log('❌', `RPA: falha ao enviar — ${JSON.stringify(r).substring(0,100)}`);
      DB.cronStats.errors++;
    }

  } catch (e) {
    log('❌', `RPA news erro: ${e.message}`);
    DB.cronStats.errors++;
  }
}

// Limpa histórico de enviados a cada 6h (recicla notícias antigas)
cron.schedule('0 */6 * * *', () => {
  const before = NEWS_SENT.size;
  NEWS_SENT.clear();
  log('♻️', `RPA: cache de notícias enviadas limpo (${before} itens)`);
}, { timezone: 'America/Sao_Paulo' });

// Cron: roda a cada 10 minutos
cron.schedule('*/10 * * * *', async () => {
  log('⏰', 'RPA cron: verificando notícias ao vivo...');
  await rpaNewsLoop();
}, { timezone: 'America/Sao_Paulo' });

// ── Rotas de controle do RPA ──────────────────────────────────
app.get('/api/rpa/status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    ok: true,
    enabled: newsRpaEnabled,
    sent: newsRpaCount,
    queued: NEWS_SENT.size,
    lastNews: CACHE.news.updatedAt ? new Date(CACHE.news.updatedAt).toISOString() : null,
    newsCount: CACHE.news.data.length,
  });
});

app.post('/api/rpa/toggle', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  newsRpaEnabled = !newsRpaEnabled;
  log('⚙️', `RPA notícias ${newsRpaEnabled ? 'ATIVADO' : 'DESATIVADO'}`);
  res.json({ ok: true, enabled: newsRpaEnabled });
});

app.post('/api/rpa/run-now', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  log('▶️', 'RPA: execução manual');
  rpaNewsLoop().catch(e => log('❌', e.message));
  res.json({ ok: true, message: 'RPA executando...' });
});

log('📰', 'RPA de notícias iniciado — envia a cada 10 minutos');

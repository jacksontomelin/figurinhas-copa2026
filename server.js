// ═══════════════════════════════════════════════════════════════
// 🚀 FAMÍLIA TOMELIN — Servidor Express + Bot Z-API
// Deploy: Railway
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const path    = require('path');
const https   = require('https');
const cron    = require('node-cron');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG Z-API (via Railway Environment Variables) ────────────
const ZAPI = {
  instance:    process.env.ZAPI_INSTANCE    || '3F155B355FA8410212E52295B0810B48',
  token:       process.env.ZAPI_TOKEN       || '9B855EED9711E32684160EE5',
  clientToken: process.env.ZAPI_CLIENT      || 'Ff0f0920827ca4987818cafa9ba0f97a7S',
  groupId:     process.env.ZAPI_GROUP_ID    || '120363409442378564-group',
  get base()   { return `https://api.z-api.io/instances/${this.instance}/token/${this.token}`; }
};

const WC_API = 'https://api.wc2026api.com';

// ── MIDDLEWARES ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Z-API HELPER ────────────────────────────────────────────────
function zapiPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: 'api.z-api.io',
      path: `/instances/${ZAPI.instance}/token/${ZAPI.token}/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI.clientToken,
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function zapiGet(endpoint) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.z-api.io',
      path: `/instances/${ZAPI.instance}/token/${ZAPI.token}/${endpoint}`,
      method: 'GET',
      headers: { 'Client-Token': ZAPI.clientToken }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sanitizePhone(phone) {
  if (String(phone).includes('@g.us')) return String(phone).trim();
  let p = String(phone).replace(/\D/g, '');
  if (p.length <= 11 && !p.startsWith('55')) p = '55' + p;
  return p;
}

// ── MENSAGENS PRÉ-DEFINIDAS ─────────────────────────────────────
const MSGS = {
  intro: `🏆 *FAMÍLIA TOMELIN — COPA 2026* ⚽🎴

Olá pessoal! O robô da Família Tomelin está no ar! 🤖✅

📅 *A Copa começa em 11 de junho de 2026!*
🇧🇷 Brasil estreia em *13 de junho às 16h* contra o Marrocos 🇲🇦

🎴 *Acesse o sistema:*
✅ Marque suas figurinhas
🔄 Troque com o grupo
🎲 Aposte nos jogos

👉 https://jacksontomelin.github.io/figurinhas-copa2026

_Família Tomelin · Copa 2026_ 🏆`,

  figurinha: `🎴 *ATENÇÃO — TROCAS DE FIGURINHAS!*

Já marcou suas figurinhas no sistema? 📱

✅ Veja o que falta no seu álbum
⭐ Anuncie suas figurinhas repetidas
🔄 Troque com outros membros
💬 Use o chat interno para combinar

👉 https://jacksontomelin.github.io/figurinhas-copa2026

*Bora completar o álbum!* 🏆🎴`,

  brasil_hoje: `🇧🇷🇧🇷🇧🇷 *É JOGO DO BRASIL HOJE!* 🇧🇷🇧🇷🇧🇷

⚽ *BORA HEXA! BORA BRASIL!* 💛💚🏆

Toda a Família Tomelin está na torcida!
Já fez seu palpite no sistema? 🎲

👉 https://jacksontomelin.github.io/figurinhas-copa2026

#VaiBrasil #Hexa #Copa2026 #FamíliaTomelin`,

  hype: `🔥 *A COPA TÁ AÍ!* 🔥

48 seleções! 104 jogos! 16 estádios!
EUA 🇺🇸 + Canadá 🇨🇦 + México 🇲🇽

O Brasil vai buscar o *HEXACAMPEONATO!* 🏆🇧🇷

Já completou seu álbum? Corre! 😂🎴

👉 https://jacksontomelin.github.io/figurinhas-copa2026

*#FamíliaTomelin #Copa2026 #Hexa*`
};

const CURIOSIDADES = [
  `⚽ *CURIOSIDADE DO DIA — COPA 2026*\n\nA Copa 2026 terá *48 seleções* pela 1ª vez na história!\nSão *104 jogos* em *16 estádios* nos EUA 🇺🇸, Canadá 🇨🇦 e México 🇲🇽\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n_Família Tomelin · Copa 2026_ 🏆`,
  `🇧🇷 *CURIOSIDADE DO DIA — COPA 2026*\n\nO Brasil é o ÚNICO país a disputar TODAS as edições da Copa do Mundo! Somos únicos! 💛💚\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n_Família Tomelin · Copa 2026_ 🏆`,
  `🎴 *CURIOSIDADE DO DIA — PANINI*\n\nPara completar o álbum da Copa 2026 são necessários em média *196 pacotinhos*! Por isso troque figurinhas conosco! 😄\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n_Família Tomelin · Copa 2026_ 🏆`,
  `🏟️ *CURIOSIDADE DO DIA — COPA 2026*\n\nO Estadio Azteca no México vai sediar sua *3ª Copa do Mundo* (1970, 1986 e 2026)! Único estádio no mundo com essa marca histórica! 🎉\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `⭐ *CURIOSIDADE DO DIA — COPA 2026*\n\nO *MetLife Stadium* em Nova York vai receber a *FINAL* no dia 19 de julho!\nO Brasil joga lá na fase de grupos também! 🇧🇷🏟️\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n_Família Tomelin · Copa 2026_ 🏆`,
  `🏆 *CURIOSIDADE DO DIA — COPA 2026*\n\nA Copa 2026 vai distribuir *US$ 1 bilhão* em premiação — recorde histórico!\nO campeão leva US$ 200 milhões! 💰⚽\n\n_Família Tomelin · Copa 2026_ 🏆`,
  `🎲 *CURIOSIDADE DO DIA — COPA 2026*\n\nNa Copa 2026 cada seleção vai jogar *ao menos 3 jogos* na fase de grupos!\nCom 48 seleções e 12 grupos de 4 times, todo mundo tem mais chances! 💪\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n_Família Tomelin · Copa 2026_ 🏆`,
];

let curiosidadeIdx = 0;

// ── FETCH COPA MATCHES ───────────────────────────────────────────
async function fetchMatches() {
  try {
    const res = await new Promise((resolve, reject) => {
      https.get(`${WC_API}/matches`, {
        headers: { Authorization: 'Bearer wc2026_free' },
        timeout: 8000
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try { resolve(JSON.parse(d)); } catch { resolve(null); }
        });
      }).on('error', reject);
    });
    const arr = Array.isArray(res) ? res : res?.matches || res?.data || [];
    return arr.map(m => ({
      ...m,
      home: m.home_team || m.home || 'TBD',
      away: m.away_team || m.away || 'TBD',
      home_score: m.home_score ?? m.score?.home ?? null,
      away_score: m.away_score ?? m.score?.away ?? null,
    }));
  } catch(e) {
    console.warn('[Copa API] Erro:', e.message);
    return [];
  }
}

function buildMatchMsg(type, m) {
  const h = m.home, a = m.away;
  const hs = m.home_score ?? 0, as_ = m.away_score ?? 0;
  const now = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const isBrasil = h.toLowerCase().includes('brasil') || a.toLowerCase().includes('brasil');
  const msgs = {
    start:  `🎉 *BOLA ROLANDO! COPA 2026!*\n\n${h} ⚔️ ${a} *COMEÇOU!*\n\n⚽ Vamos torcer juntos, Família Tomelin! 🔥${isBrasil ? '\n🇧🇷 *BORA BRASIL! HEXA!* 💛💚🏆' : ''}\n🏟️ ${m.stadium || ''}\n\n#Copa2026 #FamíliaTomelin`,
    goal:   `⚽ *GOOOOOOOL! COPA 2026!* 🎉🔥\n\n*${h} ${hs} ✕ ${as_} ${a}*\n\n${isBrasil ? '🇧🇷 *É DO BRASIL!* 💛💚🔥🏆' : 'Que emoção!'}\nFamília Tomelin na torcida! 🎴⚽\n#Copa2026 #FamíliaTomelin`,
    ht:     `☕ *INTERVALO — COPA 2026*\n\n*${h} ${hs} ✕ ${as_} ${a}*\n\nPrimeiro tempo encerrado! Segundo tempo começa em breve! ⚽\n_Família Tomelin_ 🏆`,
    ft:     `🏁 *FIM DE JOGO — RESULTADO FINAL!*\n\n*${h} ${hs} ✕ ${as_} ${a}*\n\n${isBrasil ? (hs > as_ ? '🇧🇷 *BRASIL VENCEU! BORA HEXA!* 🏆💛💚' : hs === as_ ? '🇧🇷 Empate do Brasil. Vamos em frente! 💪' : '😟 Derrota do Brasil. Mas não desistimos! 🇧🇷') : 'Jogo encerrado! Que partida!'}\n\nJá apostou no próximo jogo? 🎲\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n#Copa2026 #FamíliaTomelin`,
    live:   `🔴 *AO VIVO — COPA 2026!*\n\n*${h} ${hs} ✕ ${as_} ${a}*\n\n⏱️ ${now} BRT | 🏟️ ${m.stadium || ''}\n\nAcompanhe pelo sistema!\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n#Copa2026 #FamíliaTomelin`,
  };
  return msgs[type] || msgs.live;
}

// ── MONITOR DE JOGOS ─────────────────────────────────────────────
let _lastScores = {};
let _monitorActive = false;
let _monitorInterval = null;

async function monitorJogos() {
  if (!_monitorActive) return;
  const matches = await fetchMatches();
  for (const m of matches) {
    const ph = m.phase || m.status || '';
    const key = String(m.id);
    const hs = m.home_score, as_ = m.away_score;
    const prev = _lastScores[key];
    const isLive = ['1H','HT','2H','ET1','ET2','PEN'].includes(ph);
    const isFT   = ['FT','FT_PEN'].includes(ph);

    if (!prev && isLive) {
      // Jogo começou
      _lastScores[key] = { hs, as_, ph };
      const msg = buildMatchMsg('start', m);
      await sendToGroup(msg);
      console.log(`[Monitor] Início: ${m.home} x ${m.away}`);
    } else if (prev && isLive) {
      // Gol detectado
      if (hs !== null && as_ !== null && (hs !== prev.hs || as_ !== prev.as_)) {
        _lastScores[key] = { hs, as_, ph };
        const msg = buildMatchMsg('goal', m);
        await sendToGroup(msg);
        console.log(`[Monitor] Gol! ${m.home} ${hs} x ${as_} ${m.away}`);
        await delay(1000);
      }
      // Intervalo
      if (ph === 'HT' && prev.ph !== 'HT') {
        _lastScores[key].ph = 'HT';
        await sendToGroup(buildMatchMsg('ht', m));
        console.log(`[Monitor] Intervalo: ${m.home} x ${m.away}`);
      }
    } else if (prev && isFT && !['FT','FT_PEN'].includes(prev.ph)) {
      // Fim de jogo
      _lastScores[key] = { hs, as_, ph };
      await sendToGroup(buildMatchMsg('ft', m));
      console.log(`[Monitor] FT: ${m.home} ${hs} x ${as_} ${m.away}`);
    }

    if (!prev) _lastScores[key] = { hs, as_, ph };
  }
}

async function sendToGroup(msg) {
  try {
    const r = await zapiPost('send-text', { phone: ZAPI.groupId, message: msg });
    console.log('[Z-API] Enviado ao grupo:', r.status, r.body?.messageId || r.body);
    return r;
  } catch(e) {
    console.error('[Z-API] Erro:', e.message);
  }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── CRON JOBS ───────────────────────────────────────────────────
// Curiosidade diária — todo dia às 9h BRT (12h UTC)
cron.schedule('0 12 * * *', async () => {
  const msg = CURIOSIDADES[curiosidadeIdx % CURIOSIDADES.length];
  curiosidadeIdx++;
  console.log('[Cron] Enviando curiosidade diária...');
  await sendToGroup(msg);
});

// Lembrete de figurinhas — toda terça e quinta às 11h BRT (14h UTC)
cron.schedule('0 14 * * 2,4', async () => {
  console.log('[Cron] Lembrete de figurinhas...');
  await sendToGroup(MSGS.figurinha);
});

// Hype final de semana — sábado às 10h BRT (13h UTC)
cron.schedule('0 13 * * 6', async () => {
  console.log('[Cron] Hype de fim de semana...');
  await sendToGroup(MSGS.hype);
});

// Jogo do Brasil — 13, 19, 25 de junho às 13h BRT (16h UTC)
cron.schedule('0 16 13 6 *', async () => { await sendToGroup(MSGS.brasil_hoje); });
cron.schedule('0 16 19 6 *', async () => { await sendToGroup(MSGS.brasil_hoje); });
cron.schedule('0 16 25 6 *', async () => { await sendToGroup(MSGS.brasil_hoje); });

// Monitor de jogos — a cada 2 minutos quando ativo
_monitorInterval = setInterval(monitorJogos, 2 * 60 * 1000);
_monitorActive = true;

// ── ROTAS API ────────────────────────────────────────────────────

// Status Z-API
app.get('/api/status', async (req, res) => {
  try {
    const r = await zapiGet('status');
    res.json({ ok: r.status === 200, ...r.body });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Enviar mensagem customizada
app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' });
  const r = await zapiPost('send-text', { phone: sanitizePhone(phone), message });
  res.json({ ok: r.status === 200, ...r.body });
});

// Enviar ao grupo
app.post('/api/send-group', async (req, res) => {
  const { message, type } = req.body;
  const msg = message || MSGS[type] || CURIOSIDADES[0];
  const r = await zapiPost('send-text', { phone: ZAPI.groupId, message: msg });
  res.json({ ok: r.status === 200, messageId: r.body?.messageId, zaapId: r.body?.zaapId });
});

// Listar mensagens disponíveis
app.get('/api/mensagens', (req, res) => {
  res.json({
    tipos: Object.keys(MSGS),
    curiosidades: CURIOSIDADES.length,
    grupo: ZAPI.groupId,
    monitor_ativo: _monitorActive,
  });
});

// Ativar/desativar monitor
app.post('/api/monitor', (req, res) => {
  const { ativo } = req.body;
  _monitorActive = Boolean(ativo);
  res.json({ monitor_ativo: _monitorActive });
});

// Notificação de figurinha para usuário específico
app.post('/api/notify-sticker', async (req, res) => {
  const { toPhone, toName, fromPhone, fromName, codes } = req.body;
  if (!toPhone || !fromPhone || !codes?.length)
    return res.status(400).json({ error: 'toPhone, fromPhone e codes obrigatórios' });
  const codeList = codes.slice(0, 5).join(', ') + (codes.length > 5 ? ` +${codes.length - 5} mais` : '');
  const nome = (toName || '').split(' ')[0] || 'amigo(a)';
  const dono = fromName || 'Um membro do grupo';
  const msg = `🎴 Oi *${nome}*! Boa notícia! 🎉\n\n*${dono}* tem ${codes.length > 1 ? 'figurinhas' : 'uma figurinha'} que você precisa!\n\n🃏 *${codeList}*\n\nChama agora e combina a troca antes que alguém pegue! 💨\n📱 wa.me/55${fromPhone.replace(/\D/g,'')}\n\n_Família Tomelin · Copa 2026_ 🏆🇧🇷`;
  const r = await zapiPost('send-text', { phone: sanitizePhone(toPhone), message: msg });
  res.json({ ok: r.status === 200, ...r.body });
});

// Jogos ao vivo
app.get('/api/jogos', async (req, res) => {
  const matches = await fetchMatches();
  res.json(matches);
});

// Health check Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve páginas HTML
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/bot', (req, res) => res.sendFile(path.join(__dirname, 'bot.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));

// ── START ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Família Tomelin Bot rodando na porta ${PORT}`);
  console.log(`   📱 Z-API Instância: ${ZAPI.instance}`);
  console.log(`   👥 Grupo: ${ZAPI.groupId}`);
  console.log(`   🤖 Monitor de jogos: ATIVO`);
  console.log(`   ⏰ Cron jobs: ATIVOS\n`);
});

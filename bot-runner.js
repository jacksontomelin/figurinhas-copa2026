// 🤖 BOT FAMÍLIA TOMELIN — Copa 2026
// Execute: node bot-runner.js [tipo]
// tipos: intro | curiosidade | figurinha | brasil | hype

const https = require('https');
const ZAPI_INSTANCE = '3F155B355FA8410212E52295B0810B48';
const ZAPI_TOKEN = '9B855EED9711E32684160EE5';
const ZAPI_CLIENT = 'Ff0f0920827ca4987818cafa9ba0f97a7S';
const GROUP_ID = '120363409442378564-group';

const MSGS = {
  intro: `🏆 *FAMÍLIA TOMELIN — COPA 2026* ⚽🎴\n\nOlá pessoal! O robô da Família Tomelin está no ar! 🤖✅\n\n📅 *A Copa começa em 11 de junho de 2026!*\n🇧🇷 Brasil estreia em *13 de junho às 16h* contra o Marrocos 🇲🇦\n\n🎴 *Use nosso sistema para:*\n✅ Marcar suas figurinhas\n🔄 Trocar com o grupo\n🎲 Apostar nos jogos\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n\n_Família Tomelin · Copa 2026_ 🏆`,
  
  curiosidade: `⚽ *CURIOSIDADE DO DIA — COPA 2026*\n\nA Copa 2026 terá *48 seleções* pela 1ª vez na história!\nSão *104 jogos* em *16 estádios* nos EUA 🇺🇸, Canadá 🇨🇦 e México 🇲🇽\n\n🇧🇷 O Brasil é o ÚNICO país a disputar TODAS as edições da Copa!\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n_Família Tomelin · Copa 2026_ 🏆`,
  
  figurinha: `🎴 *ATENÇÃO — TROCAS DE FIGURINHAS!*\n\nJá marcou suas figurinhas no sistema? 📱\n\n✅ Veja o que falta no seu álbum\n⭐ Anuncie suas figurinhas repetidas\n🔄 Troque com outros membros do grupo\n💬 Use o chat interno para combinar\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n\n*Bora completar o álbum!* 🏆🎴`,
  
  brasil: `🇧🇷🇧🇷🇧🇷 *É JOGO DO BRASIL!* 🇧🇷🇧🇷🇧🇷\n\n⚽ BORA HEXA! BORA BRASIL! 💛💚🏆\n\nToda a Família Tomelin está na torcida!\nJá fez seu palpite no sistema? 🎲\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n\n#VaiBrasil #Hexa #Copa2026 #FamíliaTomelin`,
  
  hype: `🔥 *A COPA TÁ AÍ!* 🔥\n\n48 seleções! 104 jogos! 16 estádios!\n\nO Brasil vai buscar o *HEXACAMPEONATO!* 🏆🇧🇷\n\nJá completou seu álbum? Corre! 😂🎴\nUse o sistema da Família Tomelin para trocar figurinhas!\n\n👉 https://jacksontomelin.github.io/figurinhas-copa2026\n\n*#FamíliaTomelin #Copa2026 #Hexa*`
};

function sendZAPI(phone, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ phone, message });
    const req = https.request({
      hostname: 'api.z-api.io',
      path: `/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': ZAPI_CLIENT,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve({s:res.statusCode,b:JSON.parse(d)});}catch{resolve({s:res.statusCode,b:d});} });
    });
    req.on('error',reject);
    req.write(body); req.end();
  });
}

(async()=>{
  const tipo = process.argv[2]||'intro';
  const msg = MSGS[tipo]||MSGS.intro;
  console.log(`\n🤖 Enviando "${tipo}" para o grupo Família Tomelin...`);
  const r = await sendZAPI(GROUP_ID, msg);
  if(r.s===200 && r.b.messageId){
    console.log('✅ ENVIADO! MessageID:', r.b.messageId);
  } else {
    console.log('❌ Erro:', JSON.stringify(r));
  }
})();

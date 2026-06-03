# 🏆 Família Tomelin · Copa do Mundo FIFA 2026

Sistema completo de figurinhas Panini + Bot WhatsApp Z-API.

## 🔗 Links
- **App principal:** https://jacksontomelin.github.io/figurinhas-copa2026
- **Dashboard TV:** https://jacksontomelin.github.io/figurinhas-copa2026/dashboard.html
- **Painel do Bot:** https://jacksontomelin.github.io/figurinhas-copa2026/bot.html

## 🚀 Deploy Railway

### Variáveis de ambiente obrigatórias:
| Variável | Valor |
|---|---|
| `ZAPI_INSTANCE` | `3F155B355FA8410212E52295B0810B48` |
| `ZAPI_TOKEN` | `9B855EED9711E32684160EE5` |
| `ZAPI_CLIENT` | `Ff0f0920827ca4987818cafa9ba0f97a7S` |
| `ZAPI_GROUP_ID` | `120363409442378564-group` |
| `PORT` | (Railway define automaticamente) |

### Deploy:
1. Conecte este repo no Railway
2. Adicione as variáveis de ambiente acima
3. Railway instala as dependências e inicia `node server.js`

## 📡 Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Health check Railway |
| `GET` | `/api/status` | Status da conexão Z-API |
| `POST` | `/api/send` | Enviar mensagem para qualquer número |
| `POST` | `/api/send-group` | Enviar mensagem ao grupo |
| `GET` | `/api/mensagens` | Listar tipos de mensagens |
| `GET` | `/api/jogos` | Jogos ao vivo da Copa 2026 |
| `POST` | `/api/monitor` | Ativar/desativar monitor de jogos |
| `POST` | `/api/notify-sticker` | Notificar usuário sobre figurinha disponível |

### Exemplos de uso:

**Enviar ao grupo:**
```bash
curl -X POST https://SEU-RAILWAY.up.railway.app/api/send-group \
  -H "Content-Type: application/json" \
  -d '{"type":"curiosidade"}'
```

**Notificar figurinha:**
```bash
curl -X POST https://SEU-RAILWAY.up.railway.app/api/notify-sticker \
  -H "Content-Type: application/json" \
  -d '{"toPhone":"5547999999999","toName":"Ana","fromPhone":"5547888888888","fromName":"Pedro","codes":["BRA5","ARG12"]}'
```

## 🤖 Cron Jobs automáticos
- **Todo dia às 9h BRT** — Curiosidade da Copa
- **Terça e quinta às 11h BRT** — Lembrete de figurinhas
- **Sábado às 10h BRT** — Hype do fim de semana
- **13, 19 e 25 de junho às 13h BRT** — Jogo do Brasil! 🇧🇷
- **A cada 2 minutos** — Monitor de gols ao vivo

## 📦 Estrutura
```
├── index.html      → App principal de figurinhas
├── dashboard.html  → Dashboard TV
├── bot.html        → Painel do Bot (interface)
├── bot-runner.js   → Bot CLI (terminal)
├── server.js       → Servidor Express + cron jobs
├── package.json    → Dependências Node.js
└── send-test.html  → Página de teste de envio
```

**Desenvolvido com ❤️ em Pomerode — SC | Dev: Jackson Tomelin | Família Tomelin · Copa 2026 🏆**

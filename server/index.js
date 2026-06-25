const http = require('http');
const { WebSocketServer } = require('ws');
const DB = require('./DB');

const PORT = 3000;

const S2C = { RANKING_RES: 'RANKING_RES', GAME_OVER_ACK: 'GAME_OVER_ACK' };
const C2S = { GAME_OVER: 'GAME_OVER', RANKING_REQ: 'RANKING_REQ', REGISTER: 'REGISTER' };

async function main() {
  await DB.init();

  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Frontline Game Server');
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let nickname = 'Player';

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case C2S.REGISTER:
          nickname = (msg.nickname || 'Player').slice(0, 32);
          break;

        case C2S.GAME_OVER: {
          const distance = Math.floor(msg.distance || 0);
          const rank = await DB.saveRanking(nickname, distance);
          ws.send(JSON.stringify({ type: S2C.GAME_OVER_ACK, saved: true, rank }));
          break;
        }

        case C2S.RANKING_REQ: {
          const ranks = await DB.getRankings();
          ws.send(JSON.stringify({ type: S2C.RANKING_RES, ranks }));
          break;
        }
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch(console.error);

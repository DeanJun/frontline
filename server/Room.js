const { S2C } = require('./protocol');

const COLORS = ['default', 'blue', 'green', 'yellow'];
const MAX_PLAYERS = 4;

class Room {
  constructor(id) {
    this.id = id;
    this.players = new Map(); // playerId -> { ws, nickname, color, x, y, direction, state }
    this.nextColor = 0;
  }

  isFull() {
    return this.players.size >= MAX_PLAYERS;
  }

  isEmpty() {
    return this.players.size === 0;
  }

  addPlayer(playerId, ws, nickname) {
    const color = this.nextColor++;
    this.players.set(playerId, { ws, nickname, color, x: 0, y: 0, direction: 'right', state: 'idle' });

    // 입장한 플레이어에게 현재 룸 상태 전송
    this.send(ws, {
      type: S2C.ROOM_JOINED,
      roomId: this.id,
      playerId,
      players: this.getPlayersInfo(),
    });

    // 다른 플레이어들에게 입장 알림
    this.broadcast({
      type: S2C.PLAYER_JOINED,
      playerId,
      nickname,
      color: COLORS[color],
    }, playerId);
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    this.broadcast({ type: S2C.PLAYER_LEFT, playerId });
  }

  updatePlayer(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return;
    Object.assign(player, data);

    // 다른 플레이어들에게 상태 브로드캐스트
    const others = this.getOthersState(playerId);
    if (others.length === 0) return;
    this.broadcastToAll({
      type: S2C.PLAYERS_STATE,
      players: others,
    }, playerId);
  }

  getPlayersInfo() {
    return [...this.players.entries()].map(([id, p]) => ({
      playerId: id,
      nickname: p.nickname,
      color: COLORS[p.color],
      x: p.x,
      y: p.y,
      direction: p.direction,
      state: p.state,
    }));
  }

  getOthersState(excludeId) {
    return [...this.players.entries()]
      .filter(([id]) => id !== excludeId)
      .map(([id, p]) => ({
        id,
        x: p.x,
        y: p.y,
        direction: p.direction,
        state: p.state,
        color: COLORS[p.color],
      }));
  }

  broadcast(msg, excludeId = null) {
    const data = JSON.stringify(msg);
    for (const [id, p] of this.players) {
      if (id !== excludeId && p.ws.readyState === 1) {
        p.ws.send(data);
      }
    }
  }

  broadcastToAll(msg, excludeId = null) {
    this.broadcast(msg, excludeId);
  }

  send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
}

module.exports = Room;

const S2C = {
  RANKING_RES:   'RANKING_RES',
  GAME_OVER_ACK: 'GAME_OVER_ACK',
};

class Socket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        const fn = this.handlers[msg.type];
        if (fn) fn(msg);
      };
    });
  }

  on(type, fn) { this.handlers[type] = fn; }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  register(nickname) { this.send({ type: 'REGISTER', nickname }); }
  sendGameOver(distance) { this.send({ type: 'GAME_OVER', distance }); }
  requestRanking() { this.send({ type: 'RANKING_REQ' }); }
}

export { Socket, S2C };

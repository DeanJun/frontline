import { S2C } from '../net/Socket.js';

export default class RankScene extends Phaser.Scene {
  constructor() { super('RankScene'); }

  create({ socket }) {
    const { width, height } = this.scale;

    socket.on(S2C.RANKING_RES, ({ ranks }) => {
      this.add.text(width / 2, 40, 'RANKING', {
        fontSize: '32px', fill: '#fff', fontFamily: 'monospace', fontStyle: 'bold'
      }).setOrigin(0.5);

      if (ranks.length === 0) {
        this.add.text(width / 2, height / 2, '기록 없음', {
          fontSize: '20px', fill: '#aaa', fontFamily: 'monospace'
        }).setOrigin(0.5);
      } else {
        ranks.forEach((r, i) => {
          const y = 100 + i * 30;
          const color = i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#fff';
          this.add.text(width / 2, y,
            `#${r.rank}  ${r.nickname.padEnd(12)}  ${r.distance}m`,
            { fontSize: '18px', fill: color, fontFamily: 'monospace' }
          ).setOrigin(0.5);
        });
      }

      this.add.text(width / 2, height - 40, '[ ESC ] 메뉴로', {
        fontSize: '16px', fill: '#666', fontFamily: 'monospace'
      }).setOrigin(0.5);

      this.input.keyboard.on('keydown-ESC', () => {
        this.scene.start('MenuScene');
      });
    });

    socket.requestRanking();
  }
}

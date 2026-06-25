import { Socket, S2C } from '../net/Socket.js';

const WS_URL = location.protocol === 'https:'
  ? `wss://${location.hostname}/ws`
  : `ws://${location.hostname}:3000`;

export default class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  preload() {
    this.load.image('menubg', 'army2.png');
  }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;

    // 배경 이미지 (화면 꽉 채우기)
    const bg = this.add.image(cx, height / 2, 'menubg');
    const scaleX = width / bg.width;
    const scaleY = height / bg.height;
    bg.setScale(Math.max(scaleX, scaleY)).setAlpha(0.75);

    // 제목 배경 어둡게
    this.add.rectangle(cx, 60, width, 90, 0x000000, 0.55);

    this.add.text(cx, 60, 'FRONTLINE', {
      fontSize: '48px', fill: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold'
    }).setOrigin(0.5);

    // 닉네임 입력
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '닉네임 입력';
    input.maxLength = 12;
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    Object.assign(input.style, {
      position: 'absolute',
      left: `${rect.left + rect.width / 2}px`,
      top:  `${rect.top + rect.height * 0.42}px`,
      transform: 'translateX(-50%)',
      fontSize: '20px', padding: '8px 16px',
      textAlign: 'center', border: '2px solid #fff',
      background: '#111', color: '#fff', outline: 'none',
      width: '220px',
    });
    document.body.appendChild(input);
    input.focus();

    // 버튼 생성 헬퍼
    const makeButton = (x, y, label, color, hoverColor, onClick) => {
      const bg = this.add.rectangle(x, y, 180, 48, color).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, y, label, {
        fontSize: '20px', fill: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold'
      }).setOrigin(0.5);
      bg.on('pointerover',  () => bg.setFillStyle(hoverColor));
      bg.on('pointerout',   () => bg.setFillStyle(color));
      bg.on('pointerdown',  onClick);
      return { bg, txt };
    };

    const startGame = async () => {
      const nickname = input.value.trim() || 'Player';
      document.body.removeChild(input);
      const socket = new Socket(WS_URL);
      try { await socket.connect(); } catch { alert('서버 연결 실패'); return; }
      socket.register(nickname);
      this.scene.start('GameScene', { socket, nickname });
    };

    this.add.text(cx, height * 0.36, '닉네임', {
      fontSize: '14px', fill: '#aaaaaa', fontFamily: 'monospace'
    }).setOrigin(0.5);

    makeButton(cx - 100, height * 0.56, '▶ 시작', 0x226622, 0x33aa33, startGame);
    makeButton(cx + 100, height * 0.56, '★ 랭킹', 0x224466, 0x3366aa, async () => {
      document.body.removeChild(input);
      const socket = new Socket(WS_URL);
      await socket.connect();
      this.scene.start('RankScene', { socket });
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

    // 조작법
    const keys = [
      'Z 후진   C 전진   X 방패',
      'F 수류탄   D 재장전',
      'Mouse 조준   LClick 발사',
      'ESC 일시정지',
    ];

    this.add.rectangle(cx, height * 0.63 + keys.length * 11, width * 0.5, keys.length * 22 + 20, 0x000000, 0.5);

    keys.forEach((line, i) => {
      this.add.text(cx, height * 0.63 + i * 22, line, {
        fontSize: '14px',
        fill: '#ffffff',
        fontFamily: 'monospace',
        fontStyle: 'bold',
      }).setOrigin(0.5);
    });
  }
}

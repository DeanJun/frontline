import { S2C } from '../net/Socket.js';

const GRAVITY = 900;
const MOVE_SPEED = 180;
const ENEMY_SPEED = 60;
const MINI_BOSS_INTERVAL = 500;
const BOSS_INTERVAL = 2000;

const GUNS = {
  pistol:   { name: 'PISTOL',   magSize: 15,  reserve: 999, spread: 0.06, damage: 5,  pellets: 1, bulletSpeed: 1200, autoFire: false },
  shotgun:  { name: 'SHOTGUN',  magSize: 6,   reserve: 30,  spread: 0.30, damage: 4,  pellets: 6, bulletSpeed: 960,  autoFire: false },
  smg:      { name: 'SMG',      magSize: 30,  reserve: 120, spread: 0.13, damage: 3,  pellets: 1, bulletSpeed: 1120, autoFire: true  },
  sniper:   { name: 'SNIPER',   magSize: 5,   reserve: 20,  spread: 0,    damage: 5,  pellets: 1, bulletSpeed: 1900, autoFire: false },
  minigun:  { name: 'MINIGUN',  magSize: 300, reserve: 0,   spread: 0.10, damage: 5,  pellets: 1, bulletSpeed: 1300, autoFire: true,  hidden: true },
  launcher: { name: 'LAUNCHER', magSize: 3,   reserve: 9,   spread: 0.04, damage: 0,  pellets: 1, bulletSpeed: 680,  autoFire: false, hidden: true, explosive: true, explodeRadius: 90,  explodeDmg: 60  },
  bazooka:  { name: 'BAZOOKA',  magSize: 1,   reserve: 4,   spread: 0,    damage: 0,  pellets: 1, bulletSpeed: 900,  autoFire: false, hidden: true, explosive: true, explodeRadius: 250, explodeDmg: 150 },
};
const HIDDEN_GUNS = ['minigun', 'launcher', 'bazooka'];

export default class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  init({ socket, nickname }) {
    this.socket   = socket;
    this.myNickname = nickname;
    this.distance = 0;
    this.hp       = 100;
    this.grenades = 3;
    this.dead     = false;
    this.shielding  = false;
    this.reloading  = false;
    this.paused     = false;
    this.pauseOverlay = null;
    this.weaponSelectActive = false;
    this.smgFireTimer = 0;
    this.spawnedDistances = new Set();
    this.currentGun = 'pistol';
    this.mag     = GUNS.pistol.magSize;
    this.reserve = GUNS.pistol.reserve;
  }

  getGroundY(worldX) {
    const base = this.GROUND_Y;
    if (worldX < 300) return base;
    const x = worldX - 300;
    const offset = Math.sin(x * 0.006) * 38
                 + Math.sin(x * 0.0137) * 19
                 + Math.sin(x * 0.031)  * 9;
    return Math.min(base + 18, Math.max(base - 85, base + offset));
  }

  // 커서 월드 좌표 반환
  worldPointer(ptr) {
    const cam = this.cameras.main;
    return { x: ptr.x + cam.scrollX, y: ptr.y + cam.scrollY };
  }

  // 총 장착 + HUD 업데이트
  equipGun(key) {
    this.currentGun = key;
    this.mag        = GUNS[key].magSize;
    this.reserve    = GUNS[key].reserve;
    this.reloading  = false;
    this.hud.gun.setText(`GUN: ${GUNS[key].name}`);
    this.hud.ammo.setText(`AMMO: ${this.mag}/${this.reserve}`);
    this.hud.reload.setText('');
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    this.GROUND_Y = H - 48;

    this.cameras.main.setBackgroundColor('#87ceeb');

    this.bgGfx = this.add.graphics().setScrollFactor(0).setDepth(-2);

    const seed = (n) => Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
    this.bgTrees = Array.from({ length: 1200 }, (_, i) => ({
      x:       i * 55 + seed(i * 3) * 40,
      trunkH:  50 + seed(i * 5) * 35,
      canopyR: 32 + seed(i * 7) * 22,
      layer:   i % 3,
    }));

    this.terrainGfx = this.add.graphics().setDepth(0);

    this.player = this.add.rectangle(200, this.GROUND_Y - 20, 24, 40, 0xffffff, 0);
    this.physics.add.existing(this.player);
    this.player.body.setGravityY(GRAVITY);
    this.player.body.setCollideWorldBounds(false);

    this.playerGfx = this.add.graphics().setDepth(11);
    this.enemyGfx  = this.add.graphics().setDepth(10);
    this.aimLine   = this.add.graphics().setDepth(8);
    this.hpBars    = this.add.graphics().setDepth(12);
    this.shieldGfx = this.add.graphics().setDepth(9);

    this.myLabel = this.add.text(0, 0, this.myNickname, {
      fontSize: '12px', fill: '#fff', fontFamily: 'monospace'
    }).setOrigin(0.5, 1).setDepth(10);

    this.bullets      = this.physics.add.group();
    this.grenadeGroup = this.physics.add.group();
    this.enemies      = this.physics.add.group();
    this.boxes        = this.physics.add.staticGroup();
    this.enemyBullets = this.physics.add.group();
    this.bloodGroup   = this.physics.add.group();

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setBounds(0, 0, 99999, H);

    this.keys = this.input.keyboard.addKeys({
      back:   Phaser.Input.Keyboard.KeyCodes.Z,
      fwd:    Phaser.Input.Keyboard.KeyCodes.C,
      shield: Phaser.Input.Keyboard.KeyCodes.X,
      gren:   Phaser.Input.Keyboard.KeyCodes.F,
    });

    this.input.on('pointerdown', (ptr) => {
      if (ptr.leftButtonDown() && !this.dead && !this.shielding && !this.reloading
          && this.mag > 0 && !this.weaponSelectActive && !this.paused) {
        if (!GUNS[this.currentGun].autoFire) this.fireBullet(ptr);
      }
    });

    const monospaceHud = (x, y, text, fill) =>
      this.add.text(x, y, text, { fontSize: '16px', fill, fontFamily: 'monospace' }).setScrollFactor(0).setDepth(20);

    this.hud = {
      hp:     monospaceHud(16, 16,  'HP: 100',      '#0f0'),
      dist:   monospaceHud(16, 36,  'DIST: 0m',     '#ff0'),
      gren:   monospaceHud(16, 56,  'GREN: 3',      '#f80'),
      gun:    monospaceHud(16, 76,  'GUN: PISTOL',  '#fff'),
      shield: monospaceHud(16, 96,  '',             '#fd0'),
      reload: this.add.text(16, 116, '', { fontSize: '18px', fill: '#ff4', fontFamily: 'monospace', fontStyle: 'bold' }).setScrollFactor(0).setDepth(20),
      keys:   monospaceHud(16, 500, 'Z후진 C전진 X방패 F수류탄 D재장전', '#666'),
      ammo:   this.add.text(W - 16, H - 16, 'AMMO: 15/999', {
        fontSize: '28px', fill: '#00ffff', fontFamily: 'monospace', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      }).setOrigin(1, 1).setScrollFactor(0).setDepth(20),
    };

    this.input.keyboard.on('keydown-D',   () => this.startReload());
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.dead) return;
      if (this.paused) {
        this.resumeGame();
      } else {
        this.pauseGame();
      }
    });

    this.spawnTimer = this.time.addEvent({ delay: 2000, loop: true, callback: this.spawnEnemy, callbackScope: this });
    this.lastBoxDistance = 0;
    this.time.delayedCall(500, () => this.spawnBox(this.player.x + 80));

    this.physics.add.overlap(this.bullets,      this.enemies,      this.onBulletHitEnemy,    null, this);
    this.physics.add.overlap(this.grenadeGroup, this.enemies,      this.onExplosiveHitEnemy, null, this);
    this.physics.add.overlap(this.player,       this.enemies,      this.onPlayerHitEnemy,    null, this);
    this.physics.add.overlap(this.player,       this.boxes,        this.onTouchBox,          null, this);
    this.physics.add.overlap(this.player,       this.enemyBullets, this.onEnemyBulletHit,    null, this);

    this.socket.register(this.myNickname);
    this.socket.on(S2C.GAME_OVER_ACK, ({ rank }) => { if (this._rankText) this._rankText.setText(`RANK: #${rank}`); });
  }

  pauseGame() {
    this.paused = true;
    this.physics.pause();
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const bg  = this.add.rectangle(cx, cy, 300, 160, 0x000000, 0.82).setScrollFactor(0).setDepth(50);
    const txt = this.add.text(cx, cy - 48, 'PAUSED', {
      fontSize: '28px', fill: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);

    const mkBtn = (x, y, label, color, hoverColor, cb) => {
      const bg2 = this.add.rectangle(x, y, 120, 44, color).setScrollFactor(0).setDepth(51).setInteractive({ useHandCursor: true });
      const t   = this.add.text(x, y, label, { fontSize: '18px', fill: '#fff', fontFamily: 'monospace' }).setOrigin(0.5).setScrollFactor(0).setDepth(52);
      bg2.on('pointerover', () => bg2.setFillStyle(hoverColor));
      bg2.on('pointerout',  () => bg2.setFillStyle(color));
      bg2.on('pointerdown', cb);
      return [bg2, t];
    };

    const [rb, rt] = mkBtn(cx - 70, cy + 20, '▶ 재개', 0x226622, 0x33aa33, () => this.resumeGame());
    const [qb, qt] = mkBtn(cx + 70, cy + 20, '✕ 종료', 0x662222, 0xaa3333, () => { this.physics.resume(); this.scene.start('MenuScene'); });
    const hint = this.add.text(cx, cy + 68, '[ ESC ] 재개', {
      fontSize: '12px', fill: '#888888', fontFamily: 'monospace'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);

    this.pauseOverlay = { destroy: () => { bg.destroy(); txt.destroy(); rb.destroy(); rt.destroy(); qb.destroy(); qt.destroy(); hint.destroy(); } };
  }

  resumeGame() {
    this.paused = false;
    this.physics.resume();
    if (this.pauseOverlay) { this.pauseOverlay.destroy(); this.pauseOverlay = null; }
  }

  update(time, delta) {
    if (this.dead || this.weaponSelectActive) return;

    const { back, fwd, shield, gren } = this.keys;

    this.shielding = shield.isDown;
    this.hud.shield.setText(this.shielding ? '[SHIELD]' : '');

    if (!this.paused) {
      if (this.shielding) {
        this.player.body.setVelocityX(0);
      } else if (back.isDown) {
        this.player.body.setVelocityX(-MOVE_SPEED);
      } else if (fwd.isDown) {
        this.player.body.setVelocityX(MOVE_SPEED);
      } else {
        this.player.body.setVelocityX(0);
      }
    }

    // 플레이어 지형 충돌
    const playerGround = this.getGroundY(this.player.x);
    if (this.player.y + 20 >= playerGround) {
      this.player.y = playerGround - 20;
      this.player.body.y = this.player.y - 20;
      if (this.player.body.velocity.y > 0) this.player.body.velocity.y = 0;
    }

    // 수류탄/폭발물 지형 충돌
    this.grenadeGroup.getChildren().forEach(g => {
      if (!g.active || g._stopped) return;
      const gy = this.getGroundY(g.x);
      if (g.y + 6 >= gy) {
        if (g._explosive) {
          this.explodeAt(g.x, g.y, g._explodeRadius, g._explodeDmg);
          g.destroy();
        } else {
          g.y = gy - 6;
          g.body.y = g.y - 6;
          g.body.setVelocity(0, 0);
          g.body.setAllowGravity(false);
          g._stopped = true;
        }
      }
    });

    const ptr = this.input.activePointer;
    const wp  = this.worldPointer(ptr);
    const shieldDir = wp.x >= this.player.x ? 1 : -1;

    this.shieldGfx.clear();
    if (this.shielding) {
      const sx = this.player.x + shieldDir * 20;
      const sy = this.player.y;
      this.shieldGfx.fillStyle(0xffdd00, 0.5);
      this.shieldGfx.fillRect(sx - 5, sy - 26, 10, 52);
      this.shieldGfx.lineStyle(2, 0xffdd00, 1);
      this.shieldGfx.strokeRect(sx - 5, sy - 26, 10, 52);
    }

    if (!this.paused) {
      if (Phaser.Input.Keyboard.JustDown(gren) && this.grenades > 0) this.throwGrenade(ptr);

      if (GUNS[this.currentGun].autoFire && ptr.isDown && !this.shielding && !this.reloading && this.mag > 0) {
        this.smgFireTimer -= delta;
        const fireInterval = this.currentGun === 'minigun' ? 50 : 80;
        if (this.smgFireTimer <= 0) {
          this.smgFireTimer = fireInterval;
          this.fireBullet(ptr);
        }
      }

      if (this.player.x > this.distance * 10 + 200) {
        this.distance = Math.floor((this.player.x - 200) / 10);
        this.hud.dist.setText(`DIST: ${this.distance}m`);
        this.checkBossSpawn();
        if (this.distance - this.lastBoxDistance >= 250) {
          this.lastBoxDistance = this.distance;
          this.spawnBox();
        }
        // 거리에 따라 스폰 간격 감소: 0m=2000ms → 2000m=600ms
        const spawnDelay = Math.max(600, 2000 - this.distance * 0.7);
        this.spawnTimer.delay = spawnDelay;
      }
    }

    // 총알 지면 제거
    this.bullets.getChildren().forEach(b => { if (b.active && b.y >= this.getGroundY(b.x)) b.destroy(); });
    this.enemyBullets.getChildren().forEach(b => { if (b.active && b.y >= this.getGroundY(b.x)) b.destroy(); });

    // 핏방울 지면 착지 → 핏자국
    this.bloodGroup.getChildren().forEach(p => {
      if (!p.active) return;
      const gy = this.getGroundY(p.x);
      if (p.y + p.height / 2 >= gy) {
        this.add.ellipse(p.x, gy - 1, p.width + 3, 3, 0x880000, 0.75).setDepth(1);
        p.destroy();
      }
    });

    this.myLabel.setPosition(this.player.x, this.player.y - 32);
    this.drawPlayer(ptr);
    this.drawEnemyFigures();
    this.drawAimLine(ptr);
    this.drawEnemyHPBars();
    this.drawBackground();
    this.drawTerrain();

    // 적 AI + 지형 스냅
    const now = this.time.now;
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const eg = this.getGroundY(e.x);
      const targetY = eg - e.height / 2;
      e.y = targetY;
      e.body.y = targetY - e.body.halfHeight;
      e.body.prev.y = e.body.y;
      e.body.velocity.y = 0;

      const dist = Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y);
      const stopRange = e.isBoss ? 250 : 180;
      if (dist > stopRange) {
        e.body.setVelocityX((e.x > this.player.x ? -1 : 1) * (e.isBoss ? ENEMY_SPEED * 1.5 : ENEMY_SPEED));
      } else {
        e.body.setVelocityX(0);
        const cooldown = e.isBoss ? 3000 : 3000;
        if (!e._lastShot || now - e._lastShot > cooldown) {
          e._lastShot = now;
          e.isBoss ? this.bossBurst(e) : this.enemyFire(e);
        }
      }
    });
  }

  drawPlayer(ptr) {
    this.playerGfx.clear();
    const px = this.player.x, py = this.player.y;
    const wp  = this.worldPointer(ptr);
    const angle = Math.atan2(wp.y - py, wp.x - px);
    const facingRight = wp.x >= px;
    const legSwing = Math.sin(this.time.now * 0.012) * 4;

    // 다리
    this.playerGfx.fillStyle(0x4a6741, 1);
    this.playerGfx.fillRect(px - 7, py + 10, 6, 12 + (facingRight ? legSwing : -legSwing));
    this.playerGfx.fillRect(px + 1,  py + 10, 6, 12 - (facingRight ? legSwing : -legSwing));
    // 몸통
    this.playerGfx.fillStyle(0x6b8f5e, 1);
    this.playerGfx.fillRect(px - 8, py - 8, 16, 20);
    // 머리
    this.playerGfx.fillStyle(0xd4a070, 1);
    this.playerGfx.fillCircle(px, py - 14, 9);
    // 헬멧
    this.playerGfx.fillStyle(0x3d5c2e, 1);
    this.playerGfx.fillRect(px - 10, py - 24, 20, 12);
    this.playerGfx.fillRect(px - 11, py - 16, 22, 4);

    const gx0 = px + Math.cos(angle) * 4, gy0 = py - 4;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const perp = (d) => ({ x: -sin * d, y: cos * d });
    const drawBox = (ox, len, thick, color) => {
      const p = perp(thick / 2);
      this.playerGfx.fillStyle(color, 1);
      this.playerGfx.fillPoints([
        { x: gx0 + cos*ox - p.x,       y: gy0 + sin*ox - p.y       },
        { x: gx0 + cos*(ox+len) - p.x,  y: gy0 + sin*(ox+len) - p.y },
        { x: gx0 + cos*(ox+len) + p.x,  y: gy0 + sin*(ox+len) + p.y },
        { x: gx0 + cos*ox + p.x,        y: gy0 + sin*ox + p.y       },
      ], true);
    };

    switch (this.currentGun) {
      case 'pistol':
        drawBox(0,  8, 8,  0x444444);
        drawBox(8, 12, 5,  0x333333);
        break;
      case 'shotgun':
        drawBox(0,  10, 9,  0x5a3a1a);
        drawBox(10, 18, 6,  0x333333);
        drawBox(12,  5, 9,  0x444444);
        this.playerGfx.lineStyle(2, 0x222222, 1);
        this.playerGfx.beginPath();
        const mid = perp(1.5);
        this.playerGfx.moveTo(gx0 + cos*10 + mid.x, gy0 + sin*10 + mid.y);
        this.playerGfx.lineTo(gx0 + cos*28 + mid.x, gy0 + sin*28 + mid.y);
        this.playerGfx.strokePath();
        break;
      case 'smg':
        drawBox(0,  12, 8,  0x333333);
        drawBox(12, 14, 4,  0x2a2a2a);
        drawBox(4,   4, 13, 0x444444);
        break;
      case 'sniper':
        drawBox(0,  10, 7,  0x4a3010);
        drawBox(10, 28, 4,  0x222222);
        drawBox(14,  8, 8,  0x333333);
        drawBox(15,  6, 4,  0x111111);
        this.playerGfx.fillStyle(0x334455, 1);
        this.playerGfx.fillCircle(gx0 + cos*21 + perp(-7).x, gy0 + sin*21 + perp(-7).y, 3);
        break;
      case 'minigun':
        drawBox(0,  8,  10, 0x555555);
        drawBox(8,  20, 10, 0x444444);
        [-3, 0, 3].forEach(d => {
          const pp = perp(d);
          this.playerGfx.lineStyle(2, 0x222222, 1);
          this.playerGfx.beginPath();
          this.playerGfx.moveTo(gx0 + cos*8  + pp.x, gy0 + sin*8  + pp.y);
          this.playerGfx.lineTo(gx0 + cos*28 + pp.x, gy0 + sin*28 + pp.y);
          this.playerGfx.strokePath();
        });
        break;
      case 'launcher':
        drawBox(0,  10, 8,  0x4a3010);
        drawBox(10, 20, 12, 0x555533);
        drawBox(6,   5, 14, 0x444422);
        break;
      case 'bazooka':
        drawBox(0,  8,  8,  0x4a3010);
        drawBox(8,  32, 14, 0x446633);
        this.playerGfx.fillStyle(0x222222, 1);
        this.playerGfx.fillCircle(gx0 + perp(6).x, gy0 + perp(6).y, 5);
        break;
    }
  }

  drawEnemyFigures() {
    this.enemyGfx.clear();
    const now = this.time.now;
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const { x, y, isBoss } = e;
      const sc = isBoss ? 1.5 : 1;
      const swing = Math.abs(e.body.velocity.x) > 5 ? Math.sin(now * 0.013) * 4 : 0;
      const dir   = x > this.player.x ? -1 : 1;
      const bodyColor   = isBoss ? 0x6b0000 : 0x8b2222;
      const helmetColor = isBoss ? 0x3d0000 : 0x5a0f0f;

      // 다리
      this.enemyGfx.fillStyle(bodyColor, 1);
      this.enemyGfx.fillRect(x - 6*sc, y + 8*sc, 5*sc, 10*sc + swing);
      this.enemyGfx.fillRect(x + 1*sc, y + 8*sc, 5*sc, 10*sc - swing);
      // 몸통
      this.enemyGfx.fillRect(x - 7*sc, y - 8*sc, 14*sc, 18*sc);
      // 머리
      this.enemyGfx.fillStyle(0xc8956a, 1);
      this.enemyGfx.fillCircle(x, y - 13*sc, 8*sc);
      // 헬멧
      this.enemyGfx.fillStyle(helmetColor, 1);
      this.enemyGfx.fillRect(x - 9*sc,  y - 22*sc, 18*sc, 11*sc);
      this.enemyGfx.fillRect(x - 10*sc, y - 13*sc, 20*sc, 3*sc);
      // 총
      this.enemyGfx.lineStyle(isBoss ? 6 : 4, 0x222222, 1);
      this.enemyGfx.beginPath();
      this.enemyGfx.moveTo(x, y - 4*sc);
      this.enemyGfx.lineTo(x + dir * (isBoss ? 22 : 16) * sc, y - 4*sc);
      this.enemyGfx.strokePath();
    });
  }

  drawBackground() {
    const cam = this.cameras.main;
    const W = this.scale.width, H = this.scale.height;
    this.bgGfx.clear();

    this.bgGfx.fillStyle(0xc8e8a0, 0.35);
    this.bgGfx.fillRect(0, H * 0.55, W, H * 0.45);

    const PARALLAX     = [0.25, 0.55, 0.80];
    const TRUNK_COLORS = [0x5a3010, 0x6b3c12, 0x7d4815];
    const CANOPY_COLORS = [[0x1a7a0a, 0x259010], [0x20961a, 0x2eb025], [0x28b020, 0x38cc2e]];
    const SCALES       = [0.70, 1.00, 1.40];

    for (let layer = 0; layer < 3; layer++) {
      const px = PARALLAX[layer], sc = SCALES[layer];
      const tc = TRUNK_COLORS[layer];
      const [cc1, cc2] = CANOPY_COLORS[layer];
      const baseY = Math.round(this.GROUND_Y - 4);

      this.bgTrees.forEach(t => {
        if (t.layer !== layer) return;
        const screenX = t.x - cam.scrollX * px;
        if (screenX < -80 || screenX > W + 80) return;

        const trunkW = Math.round(10 * sc);
        const trunkH = Math.round(t.trunkH * sc);
        const cr     = Math.round(t.canopyR * sc);

        this.bgGfx.fillStyle(tc, 1);
        this.bgGfx.fillRect(screenX - trunkW / 2, baseY - trunkH, trunkW, trunkH);
        this.bgGfx.fillStyle(cc1, 1);
        this.bgGfx.fillCircle(screenX, baseY - trunkH - cr * 0.5, cr);
        this.bgGfx.fillStyle(cc2, 1);
        this.bgGfx.fillCircle(screenX - cr * 0.25, baseY - trunkH - cr * 0.85, cr * 0.72);
        this.bgGfx.fillCircle(screenX + cr * 0.25, baseY - trunkH - cr * 0.75, cr * 0.65);
      });
    }
  }

  drawTerrain() {
    const cam = this.cameras.main;
    const W = this.scale.width, H = this.scale.height;
    const startX = Math.floor(cam.scrollX - 80);
    const endX   = Math.ceil(cam.scrollX + W + 80);
    const step = 6;
    this.terrainGfx.clear();

    this.terrainGfx.fillStyle(0x5c3d1a, 1);
    this.terrainGfx.beginPath();
    this.terrainGfx.moveTo(startX, H + 60);
    this.terrainGfx.lineTo(startX, this.getGroundY(startX));
    for (let x = startX + step; x <= endX; x += step) this.terrainGfx.lineTo(x, this.getGroundY(x));
    this.terrainGfx.lineTo(endX, H + 60);
    this.terrainGfx.closePath();
    this.terrainGfx.fillPath();

    this.terrainGfx.lineStyle(4, 0x4a8c1c, 1);
    this.terrainGfx.beginPath();
    this.terrainGfx.moveTo(startX, this.getGroundY(startX));
    for (let x = startX + step; x <= endX; x += step) this.terrainGfx.lineTo(x, this.getGroundY(x));
    this.terrainGfx.lineTo(endX, this.getGroundY(endX));
    this.terrainGfx.strokePath();
  }

  drawEnemyHPBars() {
    this.hpBars.clear();
    this.enemies.getChildren().forEach(e => {
      if (!e.active) return;
      const by  = e.y - e.height / 2 - 30;
      const bw  = e.isBoss ? 60 : 30;
      const bx  = e.x - bw / 2;
      const ratio = Math.max(0, e.hp / e.maxHp);
      const col   = ratio > 0.5 ? 0x44ff44 : ratio > 0.25 ? 0xffaa00 : 0xff2222;
      this.hpBars.fillStyle(0x333333, 0.9);
      this.hpBars.fillRect(bx, by, bw, 5);
      this.hpBars.fillStyle(col, 1);
      this.hpBars.fillRect(bx, by, bw * ratio, 5);
    });
  }

  drawAimLine(ptr) {
    const wp = this.worldPointer(ptr);
    this.aimLine.clear();
    this.aimLine.lineStyle(1, 0xffff00, 0.4);
    this.aimLine.beginPath();
    this.aimLine.moveTo(this.player.x, this.player.y);
    this.aimLine.lineTo(wp.x, wp.y);
    this.aimLine.strokePath();
    this.aimLine.lineStyle(1, 0xffff00, 0.8);
    this.aimLine.strokeCircle(wp.x, wp.y, 6);
  }

  bossBurst(enemy) {
    [0, 300, 600].forEach(delay => {
      this.time.delayedCall(delay, () => { if (enemy.active && !this.dead) this.enemyFire(enemy); });
    });
  }

  enemyFire(enemy) {
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    const b = this.add.rectangle(enemy.x, enemy.y, 8, 4, 0xff6666);
    b.setRotation(angle);
    this.physics.add.existing(b);
    this.enemyBullets.add(b);
    b.body.setVelocity(Math.cos(angle) * (enemy.isBoss ? 320 : 240), Math.sin(angle) * (enemy.isBoss ? 320 : 240));
    b.body.setAllowGravity(false);
    this.time.delayedCall(2000, () => { if (b.active) b.destroy(); });
  }

  onEnemyBulletHit(player, bullet) {
    if (this.shielding) {
      const wp = this.worldPointer(this.input.activePointer);
      const shieldDir = wp.x >= this.player.x ? 1 : -1;
      if (shieldDir !== (bullet.body.velocity.x >= 0 ? 1 : -1)) { bullet.destroy(); return; }
    }
    bullet.destroy();
    this.hp = Math.max(0, this.hp - 10);
    this.hud.hp.setText(`HP: ${this.hp}`);
    this.cameras.main.shake(100, 0.008);
    if (this.hp <= 0) this.die();
  }

  startReload() {
    const gun = GUNS[this.currentGun];
    if (this.reloading || this.dead || this.mag === gun.magSize || this.reserve === 0) return;
    this.reloading = true;
    this.hud.reload.setText('[ RELOADING... ]');
    this.time.delayedCall(1000, () => {
      const take = Math.min(gun.magSize - this.mag, this.reserve);
      this.mag     += take;
      this.reserve -= take;
      this.reloading = false;
      this.hud.ammo.setText(`AMMO: ${this.mag}/${this.reserve}`);
      this.hud.reload.setText('');
      this.hideCenterAlert();
    });
  }

  fireBullet(ptr) {
    const gun = GUNS[this.currentGun];
    this.mag--;
    this.hud.ammo.setText(`AMMO: ${this.mag}/${this.reserve}`);

    if (this.mag === 0) {
      if (this.reserve > 0) {
        this.hud.reload.setText('[ D ] RELOAD');
        this.showCenterAlert('Out of ammo  Press [ D ] to reload');
      } else if (this.currentGun !== 'pistol') {
        this.equipGun('pistol');
        this.showFloatingText(this.player.x, this.player.y - 40, '권총으로 교체', '#aaaaaa');
      }
    }

    const shakeMap = { bazooka: 0.010, sniper: 0.018, shotgun: 0.005 };
    this.cameras.main.shake(60, shakeMap[this.currentGun] ?? 0.002);

    const wp = this.worldPointer(ptr);
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, wp.x, wp.y);

    if (gun.explosive) {
      const angle = baseAngle + (Math.random() - 0.5) * gun.spread;
      const b = this.add.circle(this.player.x, this.player.y - 10,
        this.currentGun === 'bazooka' ? 6 : 4,
        this.currentGun === 'bazooka' ? 0xff6600 : 0x66ff00);
      this.physics.add.existing(b);
      this.grenadeGroup.add(b);
      b._stopped = false;
      b._explosive = true;
      b._explodeRadius = gun.explodeRadius;
      b._explodeDmg    = gun.explodeDmg;
      b.body.setVelocity(Math.cos(angle) * gun.bulletSpeed, Math.sin(angle) * gun.bulletSpeed);
      b.body.setGravityY(this.currentGun === 'launcher' ? GRAVITY * 0.5 : GRAVITY * 0.15);
      this.time.delayedCall(3000, () => {
        if (!b.active) return;
        this.explodeAt(b.x, b.y, b._explodeRadius, b._explodeDmg);
        b.destroy();
      });
      return;
    }

    if (this.currentGun === 'sniper') {
      // 즉각 관통 레이캐스트
      const ox = this.player.x, oy = this.player.y;
      const range = 2400;
      const ex = ox + Math.cos(baseAngle) * range;
      const ey = oy + Math.sin(baseAngle) * range;

      // 레이저 이펙트
      const laser = this.add.graphics().setDepth(9);
      laser.lineStyle(2, 0xffffff, 0.9);
      laser.beginPath();
      laser.moveTo(ox, oy);
      laser.lineTo(ex, ey);
      laser.strokePath();
      this.time.delayedCall(80, () => laser.destroy());

      // 라인 위 모든 적 판정
      this.enemies.getChildren().slice().forEach(e => {
        if (!e.active) return;
        // 적 X에서 레이의 Y값 계산
        const t = (e.x - ox) / (ex - ox);
        if (t < 0 || t > 1) return;
        const rayY = oy + Math.sin(baseAngle) * (t * range);
        const eTop = e.y - e.height / 2;
        const eBot = e.y + e.height / 2;
        if (rayY < eTop || rayY > eBot) return;

        // 상단 20% = 헤드샷
        const hs = rayY <= eTop + e.height * 0.20;
        const dmg = hs ? gun.damage * 10 : gun.damage;
        if (hs) this.showFloatingText(e.x, eTop - 10, 'HEADSHOT!', '#ffee00');
        this.damageEnemy(e, dmg, baseAngle, hs);
      });
      return;
    }

    for (let i = 0; i < gun.pellets; i++) {
      const angle = baseAngle + (Math.random() - 0.5) * gun.spread;
      const b = this.add.rectangle(this.player.x, this.player.y, 8, 4, 0xffff00);
      b.setRotation(angle);
      b._damage = gun.damage;
      this.physics.add.existing(b);
      this.bullets.add(b);
      b.body.setVelocity(Math.cos(angle) * gun.bulletSpeed, Math.sin(angle) * gun.bulletSpeed);
      b.body.setAllowGravity(false);
      this.time.delayedCall(1500, () => { if (b.active) b.destroy(); });
    }
  }

  throwGrenade(ptr) {
    this.grenades--;
    this.hud.gren.setText(`GREN: ${this.grenades}`);
    const wp = this.worldPointer(ptr);
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, wp.x, wp.y);
    const g = this.add.circle(this.player.x, this.player.y - 10, 6, 0x33bb33);
    this.physics.add.existing(g);
    this.grenadeGroup.add(g);
    g._stopped = false;
    g.body.setVelocity(Math.cos(angle) * 520 + this.player.body.velocity.x * 0.6, Math.sin(angle) * 520);
    g.body.setGravityY(GRAVITY * 0.65);
    this.time.delayedCall(2000, () => {
      if (!g.active) return;
      this.explodeAt(g.x, g.y, 70, 35, true);
      g.destroy();
    });
  }

  explodeAt(x, y, radius, dmg, shrapnel = false) {
    const explosion = this.add.circle(x, y, radius,        0xff4400, 0.65).setDepth(5);
    const inner     = this.add.circle(x, y, radius * 0.5, 0xffcc00, 0.80).setDepth(6);
    this.time.delayedCall(300, () => { explosion.destroy(); inner.destroy(); });
    this.cameras.main.shake(280, Math.min(0.04, 0.012 + radius * 0.0002));

    if (shrapnel) {
      const count = Math.round(24 + radius * 0.3);
      const speed = 380 + radius * 1.5;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const b = this.add.rectangle(x, y, 10, 4, 0xff8800);
        b.setRotation(a);
        b._damage = dmg;
        this.physics.add.existing(b);
        this.bullets.add(b);
        b.body.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
        b.body.setAllowGravity(false);
        this.time.delayedCall(1800, () => { if (b.active) b.destroy(); });
      }
    } else {
      this.enemies.getChildren().slice().forEach(e => {
        if (!e.active) return;
        const dist = Phaser.Math.Distance.Between(x, y, e.x, e.y);
        if (dist <= radius) {
          const falloff = 1 - dist / radius;
          this.damageEnemy(e, Math.round(dmg * (0.4 + 0.6 * falloff)), Phaser.Math.Angle.Between(x, y, e.x, e.y));
        }
      });
    }

    for (let i = 0; i < 8; i++) this.spawnBlood(x, y, 3, Math.random() * Math.PI * 2);
  }

  spawnEnemy() {
    if (this.dead || this.weaponSelectActive || this.paused) return;
    const x = this.player.x + 400 + Math.random() * 200;
    const y = this.getGroundY(x) - 18;
    const e = this.add.rectangle(x, y, 20, 36, 0xff3333, 0);
    this.physics.add.existing(e, false);
    e.body.setAllowGravity(false);
    e.hp = 20; e.maxHp = 20; e.isBoss = false;
    this.enemies.add(e);
  }

  spawnBox(fixedX) {
    if (this.dead) return;
    const x = fixedX ?? this.player.x + 300 + Math.random() * 300;
    const y = this.getGroundY(x) - 14;
    const b = this.add.rectangle(x, y, 28, 28, 0x88aa44);
    this.physics.add.existing(b, true);
    b._label = this.add.text(x, y - 18, 'BOX', {
      fontSize: '11px', fill: '#fff', fontFamily: 'monospace'
    }).setOrigin(0.5).setDepth(8);
    this.boxes.add(b);
    this.time.delayedCall(15000, () => { if (b.active) { b._label?.destroy(); b.destroy(); } });
  }

  onTouchBox(player, box) {
    if (this.weaponSelectActive) return;
    this.showWeaponSelect(box);
  }

  showWeaponSelect(box) {
    this.weaponSelectActive = true;
    this.physics.pause();
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;

    const choices = [
      { key: 'shotgun', label: '1. SHOTGUN    6/30발  산탄' },
      { key: 'smg',     label: '2. SMG        30/120발 자동' },
      { key: 'sniper',  label: '3. SNIPER     5/20발  고데미지' },
      { key: 'hp',      label: '4. HP +10     체력 회복' },
      { key: 'grenade', label: '5. GRENADE x2 수류탄 충전' },
    ];
    const hiddenLabels = {
      minigun:  '6. ★ MINIGUN   100발    초고속연사',
      launcher: '6. ★ LAUNCHER  3/9발   유탄 포물선폭발',
      bazooka:  '6. ★ BAZOOKA   1/4발   광역 대폭발',
    };
    const hiddenKey = HIDDEN_GUNS[Math.floor(Math.random() * 3)];
    choices.push({ key: hiddenKey, label: hiddenLabels[hiddenKey], hidden: true });

    const panelH = 310;
    const panel  = this.add.rectangle(cx, cy, 420, panelH, 0x000000, 0.88).setScrollFactor(0).setDepth(50);
    const title  = this.add.text(cx, cy - panelH / 2 + 18, '선택 (1 / 2 / 3 / 4 / 5 / 6)', {
      fontSize: '16px', fill: '#ffdd00', fontFamily: 'monospace', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
    const texts = choices.map((c, i) => {
      const col = c.hidden ? '#ff88ff' : c.key === 'hp' ? '#88ff88' : c.key === 'grenade' ? '#ffaa44' : '#ffffff';
      return this.add.text(cx, cy - panelH / 2 + 50 + i * 36, c.label, {
        fontSize: '15px', fill: col, fontFamily: 'monospace'
      }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
    });

    const cleanup = () => {
      panel.destroy(); title.destroy(); texts.forEach(t => t.destroy());
      if (box.active) { box._label?.destroy(); box.destroy(); }
      this.physics.resume();
      this.weaponSelectActive = false;
    };

    const KEY_NAMES = ['ONE','TWO','THREE','FOUR','FIVE','SIX'];
    const pick = (key) => {
      KEY_NAMES.forEach((k, i) => this.input.keyboard.off(`keydown-${k}`, handlers[i]));
      if (key === 'hp') {
        this.hp = Math.min(100, this.hp + 10);
        this.hud.hp.setText(`HP: ${this.hp}`);
      } else if (key === 'grenade') {
        this.grenades += 2;
        this.hud.gren.setText(`GREN: ${this.grenades}`);
      } else {
        this.equipGun(key);
      }
      cleanup();
    };

    const handlers = [
      () => pick('shotgun'), () => pick('smg'),     () => pick('sniper'),
      () => pick('hp'),      () => pick('grenade'),  () => pick(hiddenKey),
    ];
    KEY_NAMES.forEach((k, i) => this.input.keyboard.once(`keydown-${k}`, handlers[i]));
  }

  checkBossSpawn() {
    const d = this.distance;
    if (d <= 0) return;
    if (d >= BOSS_INTERVAL && d % BOSS_INTERVAL < 10) {
      const key = `boss_${Math.floor(d / BOSS_INTERVAL)}`;
      if (!this.spawnedDistances.has(key)) { this.spawnedDistances.add(key); this.spawnBoss(true); }
    } else if (d >= MINI_BOSS_INTERVAL && d % MINI_BOSS_INTERVAL < 10) {
      const key = `mini_${Math.floor(d / MINI_BOSS_INTERVAL)}`;
      if (!this.spawnedDistances.has(key)) { this.spawnedDistances.add(key); this.spawnBoss(false); }
    }
  }

  spawnBoss(isBoss) {
    const x    = this.player.x + 500;
    const size = isBoss ? 60 : 36;
    const y    = this.getGroundY(x) - size / 2;
    const e    = this.add.rectangle(x, y, size, size, 0, 0);
    this.physics.add.existing(e, false);
    e.body.setAllowGravity(false);
    e.hp = isBoss ? 150 : 50; e.maxHp = e.hp; e.isBoss = isBoss;
    e.bossId = `${isBoss ? 'boss' : 'mini'}_${this.distance}`;
    this.enemies.add(e);
    e.label = this.add.text(x, y - size / 2 - 20, isBoss ? '★ BOSS ★' : '▲ MINI BOSS', {
      fontSize: '14px', fill: isBoss ? '#ff4444' : '#ff9900', fontFamily: 'monospace'
    }).setOrigin(0.5).setDepth(10);
  }

  onBulletHitEnemy(bullet, enemy) {
    const bulletAngle = Math.atan2(bullet.body.velocity.y, bullet.body.velocity.x);
    const isHeadshot  = bullet.y <= (enemy.y - enemy.height / 2) + enemy.height * 0.15;
    bullet.destroy();

    if (isHeadshot) {
      this.damageEnemy(enemy, (bullet._damage || 10) * 10, bulletAngle, true);
      this.showFloatingText(enemy.x, enemy.y - enemy.height / 2 - 10, 'HEADSHOT!', '#ffee00');
    } else {
      this.damageEnemy(enemy, bullet._damage || 10, bulletAngle, false);
    }
  }

  onExplosiveHitEnemy(projectile, _enemy) {
    if (!projectile.active || !projectile._explosive) return;
    this.explodeAt(projectile.x, projectile.y, projectile._explodeRadius, projectile._explodeDmg, false);
    projectile.destroy();
  }

  onPlayerHitEnemy() { }

  spawnBlood(x, y, count, bulletAngle) {
    for (let i = 0; i < count; i++) {
      const size = 3 + Math.random() * 4;
      const p = this.add.rectangle(x, y, size, size, 0xcc0000).setDepth(7);
      this.physics.add.existing(p);
      this.bloodGroup.add(p);
      p.body.setGravityY(700);
      const a = bulletAngle + (Math.random() - 0.5) * 1.4;
      p.body.setVelocity(Math.cos(a) * (70 + Math.random() * 130), Math.sin(a) * (70 + Math.random() * 130) - 80);
      this.time.delayedCall(3000, () => { if (p.active) p.destroy(); });
    }
  }

  damageEnemy(enemy, dmg, bulletAngle = 0, isHeadshot = false) {
    enemy.hp -= dmg;
    this.spawnBlood(enemy.x, enemy.y - enemy.height * 0.3, isHeadshot ? 12 : 5, bulletAngle);
    if (enemy.hp <= 0) {
      enemy.label?.destroy();
      if (enemy.isBoss) { this.hp = Math.min(100, this.hp + 50); this.hud.hp.setText(`HP: ${this.hp}`); }
      this.spawnBlood(enemy.x, enemy.y - enemy.height * 0.35, isHeadshot ? 40 : 14, bulletAngle);
      if (isHeadshot) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
          this.spawnBlood(enemy.x, enemy.y - enemy.height * 0.35, 2, a);
        }
      }
      enemy.destroy();
    }
  }

  showCenterAlert(text) {
    if (this._centerAlert) { this._centerAlert.destroy(); this._centerAlert = null; }
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this._centerAlert = this.add.text(cx, cy, text, {
      fontSize: '22px', fill: '#ff4444', fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(25);

    this.tweens.add({
      targets: this._centerAlert,
      alpha: { from: 1, to: 0.3 },
      duration: 400,
      yoyo: true,
      repeat: -1,
    });
  }

  hideCenterAlert() {
    if (this._centerAlert) { this._centerAlert.destroy(); this._centerAlert = null; }
  }

  showFloatingText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      fontSize: '14px', fill: color, fontFamily: 'monospace', fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(15);
    this.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.player.body.setVelocity(0, 0);
    this.player.body.setAllowGravity(false);
    this.cameras.main.stopFollow();
    this.physics.pause();
    this.playerGfx.clear();
    this.enemyGfx.clear();
    this.aimLine.clear();

    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    this.add.rectangle(cx, cy, 420, 220, 0x000000, 0.85).setScrollFactor(0).setDepth(30);
    this.add.text(cx, cy - 75, 'GAME OVER', {
      fontSize: '36px', fill: '#ff4444', fontFamily: 'monospace', fontStyle: 'bold'
    }).setScrollFactor(0).setDepth(31).setOrigin(0.5);
    this.add.text(cx, cy - 20, `DIST: ${this.distance}m`, {
      fontSize: '22px', fill: '#ffffff', fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(31).setOrigin(0.5);
    this._rankText = this.add.text(cx, cy + 20, 'RANK: 집계중...', {
      fontSize: '20px', fill: '#ffd700', fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(31).setOrigin(0.5);
    this.add.text(cx, cy + 75, '[ R ] RETRY   [ ESC ] MENU', {
      fontSize: '14px', fill: '#aaaaaa', fontFamily: 'monospace'
    }).setScrollFactor(0).setDepth(31).setOrigin(0.5);

    this.input.keyboard.on('keydown-R',   () => { this.physics.resume(); this.scene.restart(); });
    this.input.keyboard.on('keydown-ESC', () => { this.physics.resume(); this.scene.start('MenuScene'); });

    this.socket.sendGameOver(this.distance);
  }
}

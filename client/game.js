import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import RankScene from './scenes/RankScene.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: 960,
  height: 540,
  backgroundColor: '#000000',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false },
  },
  scene: [MenuScene, GameScene, RankScene],
});

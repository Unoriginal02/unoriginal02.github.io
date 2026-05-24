// Pixlings RTS — step 1: one static pixling sprite, nothing else

class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.image('pixling', 'assets/sprites/pixling.png');
  }

  create() {
    const cx = this.scale.width  / 2;
    const cy = this.scale.height / 2;

    this.add.image(cx, cy, 'pixling');
  }
}

new Phaser.Game({
  type:            Phaser.AUTO,
  backgroundColor: '#1a1a2e',
  scale: {
    mode:       Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
});

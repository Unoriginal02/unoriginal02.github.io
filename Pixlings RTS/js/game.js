// Pixlings RTS — Phaser 3 prototype

const WORLD_W   = 2400;
const WORLD_H   = 1600;
const TILE      = 48;
const SPEED     = 60;          // px/sec
const WORK_TIME = 5000;        // ms per work session
const WANDER_PAUSE_MIN = 1500;
const WANDER_PAUSE_MAX = 3500;
const WANDER_RADIUS = 200;
const AUTO_SEEK_RANGE = 450;   // how far a villager looks for work on its own

const JOB = { LUMBERJACK: 'lumberjack', BUILDER: 'builder' };
const S   = { IDLE: 0, WANDER: 1, WORK: 2, DRAG: 3 };

// ─────────────────────────────────────────────
// Villager
// ─────────────────────────────────────────────
class Villager {
  constructor(scene, x, y, job) {
    this.scene      = scene;
    this.job        = job;
    this.state      = S.IDLE;
    this.target     = null;   // resource/building to work on
    this.moveTo     = null;   // {x,y} walk destination
    this.workTimer  = 0;
    this.idleTimer  = Phaser.Math.Between(0, WANDER_PAUSE_MAX);
    this.wobbleT    = 0;

    // Container is the interactive/draggable object
    this.container = scene.add.container(x, y);
    this.container.setSize(30, 30);
    this.container.setInteractive();
    scene.input.setDraggable(this.container);
    this.container.setDepth(10);
    this.container.villager = this;

    this.gfx = scene.add.graphics();
    this.container.add(this.gfx);

    this._draw();
    this._bindDrag();
  }

  _colorFor(job) {
    return job === JOB.LUMBERJACK
      ? { body: 0x2a9d8f, hat: 0x1a6b60, accent: 0x57c5b5 }
      : { body: 0xe07b39, hat: 0x9c4f1a, accent: 0xf4a76f };
  }

  _draw() {
    const g = this.gfx;
    g.clear();
    const c = this._colorFor(this.job);

    // shadow
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(1, 14, 24, 8);

    // body
    g.fillStyle(c.body, 1);
    g.fillCircle(0, 1, 12);

    // face
    g.fillStyle(0xf5d0a9, 1);
    g.fillCircle(0, -1, 8);

    // hat brim
    g.fillStyle(c.hat, 1);
    g.fillRect(-9, -11, 18, 4);
    // hat top
    g.fillStyle(c.hat, 1);
    g.fillRect(-6, -20, 12, 10);

    // eyes
    g.fillStyle(0x333333, 1);
    g.fillCircle(-3, -2, 1.8);
    g.fillCircle(3, -2, 1.8);

    // tool icon
    if (this.job === JOB.LUMBERJACK) {
      g.fillStyle(0x8b5e3c, 1);
      g.fillRect(9, -4, 3, 14);
      g.fillStyle(0x888888, 1);
      g.fillTriangle(9, -4, 18, -10, 12, 2);
    } else {
      g.fillStyle(0x8b5e3c, 1);
      g.fillRect(9, -2, 3, 12);
      g.fillStyle(0xaaaaaa, 1);
      g.fillRect(8, -8, 6, 8);
    }

    // work glow
    if (this.state === S.WORK) {
      g.lineStyle(2, 0xffd700, 0.9);
      g.strokeCircle(0, 0, 15);
    }

    // drag highlight
    if (this.state === S.DRAG) {
      g.lineStyle(3, 0xffffff, 0.8);
      g.strokeCircle(0, 0, 16);
    }
  }

  _bindDrag() {
    const s = this.scene;

    this.container.on('dragstart', () => {
      this.state  = S.DRAG;
      this.target = null;
      this.moveTo = null;
      s._activeDrags++;
      this.container.setDepth(20);
      this._draw();
      s.showDropHints(this.job);
    });

    this.container.on('drag', (_ptr, dx, dy) => {
      this.container.x = dx;
      this.container.y = dy;
    });

    this.container.on('dragend', () => {
      s._activeDrags = Math.max(0, s._activeDrags - 1);
      this.container.setDepth(10);
      s.hideDropHints();

      const wx = this.container.x;
      const wy = this.container.y;
      const nearest = s.findNearestJob(wx, wy, this.job, 100);

      if (nearest) {
        this._assignJob(nearest);
      } else {
        this.state     = S.IDLE;
        this.idleTimer = 300;
      }
      this._draw();
    });
  }

  _assignJob(target) {
    this.target = target;
    this.state  = S.WANDER;
    // Walk to a spot near the target
    const angle = Math.random() * Math.PI * 2;
    this.moveTo = {
      x: target.x + Math.cos(angle) * 20,
      y: target.y + Math.sin(angle) * 20,
    };
  }

  update(delta) {
    if (this.state === S.DRAG) return;
    const dt = delta / 1000;

    if (this.state === S.IDLE) {
      this.idleTimer -= delta;
      if (this.idleTimer > 0) return;

      // Look for work within range first
      const job = this.scene.findNearestJob(
        this.container.x, this.container.y, this.job, AUTO_SEEK_RANGE
      );
      if (job) {
        this._assignJob(job);
      } else {
        // Wander randomly
        const angle = Math.random() * Math.PI * 2;
        const dist  = Phaser.Math.Between(40, WANDER_RADIUS);
        this.moveTo = {
          x: Phaser.Math.Clamp(this.container.x + Math.cos(angle) * dist, 30, WORLD_W - 30),
          y: Phaser.Math.Clamp(this.container.y + Math.sin(angle) * dist, 30, WORLD_H - 30),
        };
        this.state = S.WANDER;
      }
      return;
    }

    if (this.state === S.WANDER) {
      if (!this.moveTo) { this.state = S.IDLE; this.idleTimer = 500; return; }

      const dx   = this.moveTo.x - this.container.x;
      const dy   = this.moveTo.y - this.container.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 6) {
        this.container.x = this.moveTo.x;
        this.container.y = this.moveTo.y;
        this.moveTo = null;

        if (this.target && this.target.active) {
          this.state     = S.WORK;
          this.workTimer = WORK_TIME;
          this._draw();
        } else {
          this.target    = null;
          this.state     = S.IDLE;
          this.idleTimer = Phaser.Math.Between(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
          this._draw();
        }
      } else {
        this.container.x += (dx / dist) * SPEED * dt;
        this.container.y += (dy / dist) * SPEED * dt;
        // Leg-bob via scale
        this.wobbleT += delta * 0.01;
        this.container.scaleX = 1 + Math.sin(this.wobbleT * 3) * 0.04;
      }
      return;
    }

    if (this.state === S.WORK) {
      if (!this.target || !this.target.active) {
        this.target = null;
        this.state  = S.IDLE;
        this.idleTimer = 500;
        this._draw();
        return;
      }

      this.workTimer -= delta;

      // Visible working wiggle
      this.wobbleT += delta * 0.012;
      this.container.x = this.target.x + 18 + Math.sin(this.wobbleT * 6) * 3;
      this.container.y = this.target.y + Math.cos(this.wobbleT * 4) * 2;

      if (this.workTimer <= 0) {
        this.scene.completeWork(this.target, this.job, this);
      }
    }
  }

  destroy() {
    this.container.destroy();
  }
}

// ─────────────────────────────────────────────
// GameScene
// ─────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.villagers     = [];
    this.trees         = [];
    this.buildSites    = [];
    this.wood          = 0;
    this.builtCount    = 0;
    this._activeDrags  = 0;
    this._panStart     = null;
  }

  create() {
    this._drawTerrain();
    this._spawnTrees(28);
    this._spawnBuildSites(10);
    this._spawnVillagers();
    this._buildHUD();
    this._setupInput();
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);
  }

  // ── Terrain ───────────────────────────────
  _drawTerrain() {
    const g = this.add.graphics().setDepth(0);
    for (let tx = 0; tx < WORLD_W / TILE; tx++) {
      for (let ty = 0; ty < WORLD_H / TILE; ty++) {
        const shade = (tx + ty) % 2 === 0 ? 0x4a7c4e : 0x3f6e43;
        g.fillStyle(shade);
        g.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    g.lineStyle(3, 0x2a4a1e);
    g.strokeRect(0, 0, WORLD_W, WORLD_H);
  }

  // ── Trees ─────────────────────────────────
  _spawnTrees(count) {
    for (let i = 0; i < count; i++) {
      this._addTree(
        Phaser.Math.Between(80, WORLD_W - 80),
        Phaser.Math.Between(80, WORLD_H - 80)
      );
    }
  }

  _addTree(x, y) {
    const g = this.add.graphics().setDepth(5);
    g.x = x; g.y = y;
    g.active  = true;
    g.jobType = JOB.LUMBERJACK;
    this._drawTree(g);
    this.trees.push(g);
    return g;
  }

  _drawTree(g) {
    g.clear();
    g.fillStyle(0x6b3f1e); g.fillRect(-5, 2, 10, 22);
    g.fillStyle(0x276622); g.fillTriangle(-22, 4, 22, 4, 0, -34);
    g.fillStyle(0x318a2a); g.fillTriangle(-16, -12, 16, -12, 0, -46);
    g.fillStyle(0x40a835); g.fillTriangle(-10, -26, 10, -26, 0, -52);
  }

  // ── Building Sites ────────────────────────
  _spawnBuildSites(count) {
    for (let i = 0; i < count; i++) {
      this._addBuildSite(
        Phaser.Math.Between(80, WORLD_W - 80),
        Phaser.Math.Between(80, WORLD_H - 80)
      );
    }
  }

  _addBuildSite(x, y) {
    const g = this.add.graphics().setDepth(4);
    g.x        = x; g.y = y;
    g.active   = true;
    g.jobType  = JOB.BUILDER;
    g.progress = 0;   // 0..1
    this._drawBuildSite(g);
    this.buildSites.push(g);
    return g;
  }

  _drawBuildSite(g) {
    g.clear();
    const p = g.progress;

    // Foundation
    g.fillStyle(0x8a8a8a); g.fillRect(-26, -4, 52, 10);

    // Walls (grow with progress)
    const wh = Math.floor(p * 36);
    if (wh > 0) {
      g.fillStyle(0xc4934a);
      g.fillRect(-26, -4 - wh, 8,  wh);  // left wall
      g.fillRect( 18, -4 - wh, 8,  wh);  // right wall
      if (p > 0.5) {
        g.fillRect(-26, -4 - wh, 52, 8);  // top beam
      }
    }

    // Roof when done
    if (p >= 1) {
      g.fillStyle(0xb03030);
      g.fillTriangle(-30, -40, 30, -40, 0, -64);
      g.fillStyle(0xc4934a);
      g.fillRect(-26, -40, 52, 36);
      // window
      g.fillStyle(0xadd8e6, 0.9);
      g.fillRect(-8, -30, 16, 14);
      g.lineStyle(2, 0x8a6a30);
      g.strokeRect(-8, -30, 16, 14);
    }

    // Progress bar
    g.fillStyle(0x222222, 0.65);
    g.fillRect(-26, 12, 52, 7);
    g.fillStyle(p >= 1 ? 0x27ae60 : 0xe8a020);
    g.fillRect(-26, 12, 52 * p, 7);

    if (p < 1) {
      // Dashed outline shows it needs work
      g.lineStyle(2, 0xffd700, 0.7);
      g.strokeRect(-26, -4, 52, 10);
    }
  }

  // ── Villagers ─────────────────────────────
  _spawnVillagers() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const jobs = [
      JOB.LUMBERJACK, JOB.LUMBERJACK, JOB.LUMBERJACK,
      JOB.BUILDER,    JOB.BUILDER,    JOB.BUILDER,
    ];
    for (const job of jobs) {
      const v = new Villager(
        this,
        cx + Phaser.Math.Between(-120, 120),
        cy + Phaser.Math.Between(-120, 120),
        job
      );
      this.villagers.push(v);
    }
  }

  // ── HUD ───────────────────────────────────
  _buildHUD() {
    const bg = this.add.graphics().setScrollFactor(0).setDepth(90);
    bg.fillStyle(0x0d0d1a, 0.82);
    bg.fillRoundedRect(0, 0, this.scale.width, 54, 0);

    const ts = { fontSize: '17px', fill: '#e8d5b7', fontFamily: 'monospace' };

    this.woodTxt  = this.add.text(16, 14, 'Wood: 0',     ts).setScrollFactor(0).setDepth(91);
    this.buildTxt = this.add.text(160, 14, 'Houses: 0',  ts).setScrollFactor(0).setDepth(91);

    const hint = this.add.text(
      this.scale.width - 12, 14,
      'Drag villagers onto jobs  |  Teal = Lumberjack  Orange = Builder',
      { fontSize: '12px', fill: '#888', fontFamily: 'monospace' }
    ).setScrollFactor(0).setDepth(91).setOrigin(1, 0);

    // Wood / house icons drawn via graphics
    const ico = this.add.graphics().setScrollFactor(0).setDepth(91);
    // wood icon (tree silhouette)
    ico.fillStyle(0x6b3f1e); ico.fillRect(10, 20, 4, 10);
    ico.fillStyle(0x3a8a3a); ico.fillTriangle(5, 20, 19, 20, 12, 10);
    // house icon
    ico.fillStyle(0xb03030); ico.fillTriangle(153, 9, 171, 9, 162, 3);
    ico.fillStyle(0xc4934a); ico.fillRect(153, 9, 18, 10);

    this.woodTxt.x  = 22;
    this.buildTxt.x = 163;
  }

  _updateHUD() {
    this.woodTxt.setText(`Wood: ${this.wood}`);
    this.buildTxt.setText(`Houses: ${this.builtCount}`);
  }

  // ── Drop hints ────────────────────────────
  showDropHints(job) {
    const targets = job === JOB.LUMBERJACK ? this.trees : this.buildSites;
    for (const t of targets) {
      if (!t.active) continue;
      if (job === JOB.BUILDER && t.progress >= 1) continue;
      if (!t._hint) {
        t._hint = this.add.graphics().setDepth(6);
      }
      t._hint.clear();
      t._hint.lineStyle(2, 0xffffff, 0.55);
      t._hint.strokeCircle(t.x, t.y, 32);
    }
  }

  hideDropHints() {
    for (const t of [...this.trees, ...this.buildSites]) {
      if (t._hint) { t._hint.clear(); }
    }
  }

  // ── Job logic ─────────────────────────────
  findNearestJob(x, y, jobType, maxDist) {
    const pool = jobType === JOB.LUMBERJACK ? this.trees : this.buildSites;
    let best = null, bestD = maxDist;

    for (const t of pool) {
      if (!t.active) continue;
      if (jobType === JOB.BUILDER && t.progress >= 1) continue;
      // Only one villager per target at a time
      const busy = this.villagers.some(v =>
        v.target === t && (v.state === S.WORK || v.state === S.WANDER)
      );
      if (busy) continue;

      const d = Phaser.Math.Distance.Between(x, y, t.x, t.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  completeWork(target, jobType, villager) {
    villager.target    = null;
    villager.state     = S.IDLE;
    villager.idleTimer = 800;
    villager._draw();

    if (jobType === JOB.LUMBERJACK) {
      this.wood++;
      target.active = false;
      this._updateHUD();
      this.tweens.add({
        targets: target, alpha: 0, scaleX: 0, scaleY: 0,
        duration: 350, ease: 'Power2',
        onComplete: () => {
          target.destroy();
          this.trees = this.trees.filter(t => t !== target);
          // Respawn elsewhere after a while
          this.time.delayedCall(Phaser.Math.Between(8000, 15000), () => {
            this._addTree(
              Phaser.Math.Between(80, WORLD_W - 80),
              Phaser.Math.Between(80, WORLD_H - 80)
            );
          });
        }
      });
    } else {
      target.progress = Math.min(1, target.progress + 0.34); // 3 sessions to build
      this._drawBuildSite(target);
      if (target.progress >= 1) {
        this.builtCount++;
        target.active = false;
        this._updateHUD();
        // Flash effect on completion
        this.tweens.add({
          targets: target, alpha: 0.4,
          yoyo: true, repeat: 3, duration: 120,
        });
      }
    }
  }

  // ── Input / camera pan ────────────────────
  _setupInput() {
    // Pan: touch or mouse drag on empty space
    this.input.on('pointerdown', (ptr) => {
      if (this._activeDrags === 0) {
        this._panStart = { x: ptr.x, y: ptr.y };
      }
    });

    this.input.on('pointermove', (ptr) => {
      if (this._activeDrags > 0) return;
      if (!ptr.isDown || !this._panStart) return;
      this.cameras.main.scrollX -= (ptr.x - this._panStart.x);
      this.cameras.main.scrollY -= (ptr.y - this._panStart.y);
      this._panStart = { x: ptr.x, y: ptr.y };
    });

    this.input.on('pointerup',   () => { this._panStart = null; });
    this.input.on('pointerout',  () => { this._panStart = null; });
  }

  // ── Update loop ───────────────────────────
  update(_time, delta) {
    for (const v of this.villagers) v.update(delta);

    // Desktop edge-scroll
    if (this._activeDrags === 0) {
      const ptr  = this.input.activePointer;
      const cam  = this.cameras.main;
      const edge = 36, spd = 5;
      if (ptr.x < edge)                     cam.scrollX -= spd;
      if (ptr.x > this.scale.width  - edge) cam.scrollX += spd;
      if (ptr.y < edge)                     cam.scrollY -= spd;
      if (ptr.y > this.scale.height - edge) cam.scrollY += spd;
    }
  }
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }
  create() {
    const cx = this.scale.width  / 2;
    const cy = this.scale.height / 2;

    this.add.text(cx, cy - 24, 'PIXLINGS RTS', {
      fontSize: '32px', fill: '#e8d5b7', fontFamily: 'monospace', fontStyle: 'bold'
    }).setOrigin(0.5);

    this.add.text(cx, cy + 18, 'Loading world...', {
      fontSize: '15px', fill: '#888', fontFamily: 'monospace'
    }).setOrigin(0.5);

    this.time.delayedCall(600, () => this.scene.start('GameScene'));
  }
}

// ─────────────────────────────────────────────
// Phaser config
// ─────────────────────────────────────────────
new Phaser.Game({
  type: Phaser.AUTO,
  backgroundColor: '#1a1a2e',
  scale: {
    mode:       Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width:  960,
    height: 640,
  },
  input: {
    activePointers: 3,   // support multi-touch
  },
  scene: [BootScene, GameScene],
});

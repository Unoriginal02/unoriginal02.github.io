// Pixlings RTS — v2

const WORLD_W          = 2400;
const WORLD_H          = 1600;
const TILE             = 48;
const SPEED            = 65;
const WORK_TIME        = 5000;
const WANDER_PAUSE_MIN = 1500;
const WANDER_PAUSE_MAX = 3500;
const WANDER_RADIUS    = 200;
const AUTO_SEEK_RANGE  = 450;
const ZOOM_MIN         = 0.25;
const ZOOM_MAX         = 3.0;

const JOB = { LUMBERJACK: 'lumberjack', BUILDER: 'builder' };
const S   = { IDLE: 0, WANDER: 1, WORK: 2, DRAG: 3 };

// ─────────────────────────────────────────────
// Villager
// ─────────────────────────────────────────────
class Villager {
  constructor(scene, x, y, job) {
    this.scene     = scene;
    this.job       = job;
    this.state     = S.IDLE;
    this.target    = null;
    this.moveTo    = null;
    this.workTimer = 0;
    this.idleTimer = Phaser.Math.Between(0, WANDER_PAUSE_MAX);
    this._t        = Phaser.Math.Between(0, 3000); // stagger animations

    this.container = scene.add.container(x, y);
    this.container.setSize(34, 42);
    this.container.setInteractive({ useHandCursor: true });
    scene.input.setDraggable(this.container);
    this.container.setDepth(10);
    this.container.villager = this;

    this.gfx = scene.add.graphics();
    this.container.add(this.gfx);

    this._draw();
    this._bindDrag();
  }

  _colors() {
    return this.job === JOB.LUMBERJACK
      ? { shirt: 0x2a9d8f, hat: 0x1a6b60, skin: 0xf5c9a0, pants: 0x1e5c55, shoe: 0x2d2d2d }
      : { shirt: 0xe07b39, hat: 0x9c4f1a, skin: 0xf5c9a0, pants: 0x7a3010, shoe: 0x2d2d2d };
  }

  _draw() {
    const g  = this.gfx;
    const c  = this._colors();
    const t  = this._t;
    const st = this.state;
    g.clear();

    // ── Animation parameters ──────────────────
    let bodyOY  = 0;   // whole body vertical shift
    let legLdY  = 0;   // left  leg extra length
    let legRdY  = 0;   // right leg extra length
    let armLdY  = 0;   // left  arm extra drop
    let armRdY  = 0;   // right arm extra drop
    let toolAng = 0;   // tool end offset (working swing)

    if (st === S.IDLE) {
      bodyOY = Math.sin(t * 0.0018) * 1.5;
    } else if (st === S.WANDER) {
      const ph = t * 0.0085;
      bodyOY = Math.abs(Math.sin(ph)) * -2;
      legLdY = Math.sin(ph)          *  7;
      legRdY = Math.sin(ph + Math.PI)*  7;
      armLdY = Math.sin(ph + Math.PI)*  6;
      armRdY = Math.sin(ph)          *  6;
    } else if (st === S.WORK) {
      // Arm swing: -1 (tool up) to +1 (tool down / impact)
      const ph = t * 0.005;
      toolAng = Math.sin(ph);                          // -1..1
      bodyOY  = Math.sin(ph * 2 + Math.PI) * 2;       // crouch on impact
    } else if (st === S.DRAG) {
      bodyOY = -5;
    }

    const by = bodyOY;

    // ── Shadow ────────────────────────────────
    g.fillStyle(0x000000, 0.18);
    g.fillEllipse(0, 24, 28, 9);

    // ── Legs ──────────────────────────────────
    g.fillStyle(c.pants);
    g.fillRect(-10, 9 + by, 8, 12 + Math.max(0, legLdY));
    g.fillRect(  2, 9 + by, 8, 12 + Math.max(0, legRdY));
    // shoes
    g.fillStyle(c.shoe);
    g.fillRect(-11, 21 + by + Math.max(0, legLdY), 10, 5);
    g.fillRect(  1, 21 + by + Math.max(0, legRdY), 10, 5);

    // ── Shirt / body ──────────────────────────
    g.fillStyle(c.shirt);
    g.fillRoundedRect(-12, -5 + by, 24, 16, 4);

    // ── Arms ──────────────────────────────────
    if (st === S.WORK) {
      // Left arm rests; right arm swings the tool
      g.fillStyle(c.shirt);
      g.fillRect(-17, -3 + by, 7, 13);  // left arm (still)

      // Approximate tool-arm swing by moving the hand endpoint
      // toolAng: -1 = raised, +1 = impact (down)
      const handX = 14 + toolAng * 5;
      const handY = -4 + (toolAng + 1) * 11 + by;  // -4 (up) to 18 (down)

      // Upper arm: shoulder → elbow (midpoint)
      const elbX = 12 + toolAng * 3;
      const elbY = 4 + by;
      g.fillStyle(c.shirt);
      g.fillRect(10, -3 + by, 6, 8 + Math.max(0, (elbY - (-3 + by) - 8)));

      // Tool handle
      g.lineStyle(4, 0x8b5e3c, 1);
      g.beginPath();
      g.moveTo(elbX, elbY);
      g.lineTo(handX, handY);
      g.strokePath();

      // Tool head
      if (this.job === JOB.LUMBERJACK) {
        g.fillStyle(0x999999);
        g.fillRect(handX - 2, handY - 5, 9, 7);
        g.fillStyle(0x777777);
        g.fillRect(handX + 5, handY - 6, 4, 9);
      } else {
        g.fillStyle(0x888888);
        g.fillRect(handX - 3, handY - 4, 8, 8);
      }
    } else {
      // Both arms hang / swing while walking
      g.fillStyle(c.shirt);
      g.fillRect(-17, -3 + by + armLdY, 7, 13);
      g.fillRect( 10, -3 + by + armRdY, 7, 13);
    }

    // ── Head ──────────────────────────────────
    g.fillStyle(c.skin);
    g.fillCircle(0, -14 + by, 11);

    // ── Eyes ──────────────────────────────────
    if (st === S.WORK) {
      // Determined squint
      g.fillStyle(0x333333);
      g.fillRect(-5, -16 + by, 4, 2);
      g.fillRect( 1, -16 + by, 4, 2);
    } else {
      g.fillStyle(0x333333);
      g.fillCircle(-4, -15 + by, 1.8);
      g.fillCircle( 4, -15 + by, 1.8);
      // smile dot
      g.fillStyle(0xcc9977);
      g.fillCircle(0, -11 + by, 1.2);
    }

    // ── Hat ───────────────────────────────────
    g.fillStyle(c.hat);
    g.fillRect(-13, -22 + by, 26, 5);  // brim
    g.fillRect( -9, -34 + by, 18, 13); // crown

    // ── Drag glow ─────────────────────────────
    if (st === S.DRAG) {
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeCircle(0, -5, 26);
    }

    // ── Work indicator (pulsing dot above) ────
    if (st === S.WORK) {
      const pulse = 0.55 + Math.abs(Math.sin(t * 0.006)) * 0.45;
      g.fillStyle(0xffd700, pulse);
      g.fillCircle(0, -46 + by, 5);
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
      this.container.setScale(1.25);
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
      this.container.setScale(1);
      s.hideDropHints();

      const nearest = s.findNearestJob(
        this.container.x, this.container.y, this.job, 110
      );
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
    const angle = Math.random() * Math.PI * 2;
    this.moveTo = {
      x: target.x + Math.cos(angle) * 22,
      y: target.y + Math.sin(angle) * 22,
    };
  }

  update(delta) {
    if (this.state === S.DRAG) return;
    this._t += delta;
    const dt = delta / 1000;

    // Always redraw — animations run every frame
    this._draw();

    if (this.state === S.IDLE) {
      this.idleTimer -= delta;
      if (this.idleTimer > 0) return;

      const job = this.scene.findNearestJob(
        this.container.x, this.container.y, this.job, AUTO_SEEK_RANGE
      );
      if (job) {
        this._assignJob(job);
      } else {
        const angle = Math.random() * Math.PI * 2;
        const dist  = Phaser.Math.Between(40, WANDER_RADIUS);
        this.moveTo = {
          x: Phaser.Math.Clamp(this.container.x + Math.cos(angle) * dist, 40, WORLD_W - 40),
          y: Phaser.Math.Clamp(this.container.y + Math.sin(angle) * dist, 60, WORLD_H - 40),
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
          this._t        = 0;
        } else {
          this.target    = null;
          this.state     = S.IDLE;
          this.idleTimer = Phaser.Math.Between(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
        }
      } else {
        this.container.x += (dx / dist) * SPEED * dt;
        this.container.y += (dy / dist) * SPEED * dt;
      }
      return;
    }

    if (this.state === S.WORK) {
      if (!this.target || !this.target.active) {
        this.target    = null;
        this.state     = S.IDLE;
        this.idleTimer = 500;
        return;
      }

      // Stand next to target, face it — no jitter
      const angle = Math.atan2(
        this.container.y - this.target.y,
        this.container.x - this.target.x
      );
      this.container.x = this.target.x + Math.cos(angle) * 26;
      this.container.y = this.target.y + Math.sin(angle) * 14;

      this.workTimer -= delta;
      if (this.workTimer <= 0) {
        this.scene.completeWork(this.target, this.job, this);
      }
    }
  }

  destroy() { this.container.destroy(); }
}

// ─────────────────────────────────────────────
// GameScene
// ─────────────────────────────────────────────
class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.villagers    = [];
    this.trees        = [];
    this.buildSites   = [];
    this.wood         = 0;
    this.builtCount   = 0;
    this._activeDrags = 0;
    this._panStart    = null;
    this._pinchDist   = null;
  }

  preload() {
    this.load.image('grass',      'assets/sprites/grass.png');
    this.load.image('tree_round', 'assets/sprites/tree_round.png');
    this.load.image('tree_pine',  'assets/sprites/tree_pine.png');
    this.load.image('tree_bush',  'assets/sprites/tree_bush.png');
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
    this.cameras.main.setZoom(1);

    this.scale.on('resize', this._onResize, this);
  }

  _onResize() {
    this._updateHUDLayout();
  }

  // ── Terrain ───────────────────────────────
  _drawTerrain() {
    // Kenney grass tile tiled across the entire world
    this.add.tileSprite(0, 0, WORLD_W, WORLD_H, 'grass')
      .setOrigin(0, 0)
      .setDepth(0);
    // World border
    const g = this.add.graphics().setDepth(1);
    g.lineStyle(5, 0x2a4a1e);
    g.strokeRect(0, 0, WORLD_W, WORLD_H);
  }

  // ── Trees ─────────────────────────────────
  _spawnTrees(n) {
    for (let i = 0; i < n; i++)
      this._addTree(Phaser.Math.Between(80, WORLD_W - 80), Phaser.Math.Between(80, WORLD_H - 80));
  }

  _addTree(x, y) {
    const variants = ['tree_round', 'tree_pine', 'tree_bush'];
    // Weighted: round 50%, pine 30%, bush 20%
    const weights = [0.5, 0.8, 1.0];
    const r = Math.random();
    const key = variants[weights.findIndex(w => r < w)];
    const img = this.add.image(x, y, key)
      .setDepth(5)
      .setScale(0.8 + Math.random() * 0.45);
    img.active  = true;
    img.jobType = JOB.LUMBERJACK;
    this.trees.push(img);
    return img;
  }

  // ── Building Sites ────────────────────────
  _spawnBuildSites(n) {
    for (let i = 0; i < n; i++)
      this._addBuildSite(Phaser.Math.Between(80, WORLD_W - 80), Phaser.Math.Between(80, WORLD_H - 80));
  }

  _addBuildSite(x, y) {
    const g = this.add.graphics().setDepth(4);
    g.x = x; g.y = y; g.active = true; g.jobType = JOB.BUILDER; g.progress = 0;
    this._drawBuildSite(g);
    this.buildSites.push(g);
    return g;
  }

  _drawBuildSite(g) {
    g.clear();
    const p = g.progress;
    g.fillStyle(0x8a8a8a); g.fillRect(-26, -4, 52, 10);
    const wh = Math.floor(p * 36);
    if (wh > 0) {
      g.fillStyle(0xc4934a);
      g.fillRect(-26, -4 - wh, 8, wh);
      g.fillRect( 18, -4 - wh, 8, wh);
      if (p > 0.5) g.fillRect(-26, -4 - wh, 52, 8);
    }
    if (p >= 1) {
      g.fillStyle(0xb03030); g.fillTriangle(-30, -40, 30, -40, 0, -64);
      g.fillStyle(0xc4934a); g.fillRect(-26, -40, 52, 36);
      g.fillStyle(0xadd8e6, 0.9); g.fillRect(-8, -30, 16, 14);
      g.lineStyle(2, 0x8a6a30); g.strokeRect(-8, -30, 16, 14);
    }
    g.fillStyle(0x222222, 0.65); g.fillRect(-26, 12, 52, 7);
    g.fillStyle(p >= 1 ? 0x27ae60 : 0xe8a020); g.fillRect(-26, 12, 52 * p, 7);
    if (p < 1) { g.lineStyle(2, 0xffd700, 0.7); g.strokeRect(-26, -4, 52, 10); }
  }

  // ── Villagers ─────────────────────────────
  _spawnVillagers() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    for (const job of [
      JOB.LUMBERJACK, JOB.LUMBERJACK, JOB.LUMBERJACK,
      JOB.BUILDER,    JOB.BUILDER,    JOB.BUILDER,
    ]) {
      this.villagers.push(new Villager(
        this,
        cx + Phaser.Math.Between(-130, 130),
        cy + Phaser.Math.Between(-130, 130),
        job
      ));
    }
  }

  // ── HUD ───────────────────────────────────
  _buildHUD() {
    this._hudBg     = this.add.graphics().setScrollFactor(0).setDepth(90);
    const ts        = { fontSize: '16px', fill: '#e8d5b7', fontFamily: 'monospace' };
    this._woodTxt   = this.add.text(14, 15, 'Wood: 0',    ts).setScrollFactor(0).setDepth(91);
    this._buildTxt  = this.add.text(150, 15, 'Houses: 0', ts).setScrollFactor(0).setDepth(91);
    this._hintTxt   = this.add.text(0, 15,
      'Drag villagers  |  Scroll / Pinch to zoom  |  Drag map to pan',
      { fontSize: '11px', fill: '#666', fontFamily: 'monospace' }
    ).setScrollFactor(0).setDepth(91).setOrigin(1, 0);
    this._updateHUDLayout();
  }

  _updateHUDLayout() {
    if (!this._hudBg) return;
    const W = this.scale.width;
    this._hudBg.clear();
    this._hudBg.fillStyle(0x0d0d1a, 0.82);
    this._hudBg.fillRect(0, 0, W, 50);
    this._hintTxt.x = W - 12;
  }

  _updateHUD() {
    this._woodTxt.setText(`Wood: ${this.wood}`);
    this._buildTxt.setText(`Houses: ${this.builtCount}`);
  }

  // ── Drop hints ────────────────────────────
  showDropHints(job) {
    const pool = job === JOB.LUMBERJACK ? this.trees : this.buildSites;
    for (const t of pool) {
      if (!t.active) continue;
      if (job === JOB.BUILDER && t.progress >= 1) continue;
      if (!t._hint) t._hint = this.add.graphics().setDepth(6);
      t._hint.clear();
      t._hint.lineStyle(2, 0xffffff, 0.5);
      t._hint.strokeCircle(t.x, t.y, 38);
    }
  }

  hideDropHints() {
    for (const t of [...this.trees, ...this.buildSites])
      if (t._hint) t._hint.clear();
  }

  // ── Job logic ─────────────────────────────
  findNearestJob(x, y, jobType, maxDist) {
    const pool = jobType === JOB.LUMBERJACK ? this.trees : this.buildSites;
    let best = null, bestD = maxDist;
    for (const t of pool) {
      if (!t.active) continue;
      if (jobType === JOB.BUILDER && t.progress >= 1) continue;
      const busy = this.villagers.some(
        v => v.target === t && (v.state === S.WORK || v.state === S.WANDER)
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

    if (jobType === JOB.LUMBERJACK) {
      this.wood++;
      target.active = false;
      this._updateHUD();
      this.tweens.add({
        targets: target, alpha: 0, scale: 0,
        duration: 400, ease: 'Power2',
        onComplete: () => {
          target.destroy();
          this.trees = this.trees.filter(t => t !== target);
          this.time.delayedCall(Phaser.Math.Between(8000, 14000), () =>
            this._addTree(Phaser.Math.Between(80, WORLD_W - 80), Phaser.Math.Between(80, WORLD_H - 80))
          );
        },
      });
    } else {
      target.progress = Math.min(1, target.progress + 0.34);
      this._drawBuildSite(target);
      if (target.progress >= 1) {
        this.builtCount++;
        target.active = false;
        this._updateHUD();
        this.tweens.add({ targets: target, alpha: 0.4, yoyo: true, repeat: 3, duration: 120 });
      }
    }
  }

  // ── Input ─────────────────────────────────
  _setupInput() {
    // Mouse wheel → zoom
    this.input.on('wheel', (_ptr, _objs, _dx, dy) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dy * 0.0012, ZOOM_MIN, ZOOM_MAX));
    });

    // Pointer down — only start pan if NOT on a villager
    this.input.on('pointerdown', (ptr, currentlyOver) => {
      const hitsVillager = currentlyOver && currentlyOver.some(go => go.villager);
      if (!hitsVillager) {
        this._panStart = { x: ptr.x, y: ptr.y };
      }
    });

    // Pointer move — pan or pinch
    this.input.on('pointermove', (ptr) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;

      // Two-finger pinch zoom (mobile)
      if (p1.isDown && p2.isDown && this._activeDrags === 0) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this._pinchDist !== null) {
          const cam   = this.cameras.main;
          const delta = (dist - this._pinchDist) * 0.006;
          cam.setZoom(Phaser.Math.Clamp(cam.zoom + delta, ZOOM_MIN, ZOOM_MAX));
        }
        this._pinchDist = dist;
        this._panStart  = null;
        return;
      }
      this._pinchDist = null;

      // Single-pointer camera pan
      if (this._activeDrags > 0 || !ptr.isDown || !this._panStart) return;
      const cam = this.cameras.main;
      cam.scrollX -= (ptr.x - this._panStart.x) / cam.zoom;
      cam.scrollY -= (ptr.y - this._panStart.y) / cam.zoom;
      this._panStart = { x: ptr.x, y: ptr.y };
    });

    this.input.on('pointerup',  () => { this._panStart = null; });
    this.input.on('pointerout', () => { this._panStart = null; });
  }

  // ── Update ────────────────────────────────
  update(_time, delta) {
    for (const v of this.villagers) v.update(delta);

    // Desktop edge-scroll (only when pointer not held down for pan)
    if (this._activeDrags === 0 && !this.input.pointer1.isDown) {
      const ptr  = this.input.activePointer;
      const cam  = this.cameras.main;
      const edge = 40;
      const spd  = 5 / cam.zoom;
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
    const cx = this.scale.width / 2, cy = this.scale.height / 2;
    this.add.text(cx, cy - 22, 'PIXLINGS RTS', {
      fontSize: '30px', fill: '#e8d5b7', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.add.text(cx, cy + 20, 'Loading world...', {
      fontSize: '14px', fill: '#888', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.time.delayedCall(500, () => this.scene.start('GameScene'));
  }
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
new Phaser.Game({
  type:            Phaser.AUTO,
  backgroundColor: '#1a1a2e',
  scale: {
    mode:       Phaser.Scale.RESIZE,   // fills 100% of the window
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 3,                 // support multi-touch
  },
  scene: [BootScene, GameScene],
});

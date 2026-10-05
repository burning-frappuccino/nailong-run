/* ============================================================================
 * 奶龙跑酷 · 粒子层
 * 世界坐标粒子（金币爆开、尘土、火花、雪花…）+ 屏幕坐标飘字。
 * 固定容量对象池，零 GC 压力。
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const { clamp, lerp, project, project3, rgba } = NR;
  const T = NR.T;

  const CAP = T.particleMax || 420;
  const pool = [];
  for (let i = 0; i < CAP; i++) {
    pool.push({
      alive: false, kind: 'dot', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0, maxLife: 1, size: 6, grav: 0, drag: 0, spin: 0, angle: 0,
      color: '#fff', color2: null, alpha: 1, shape: 'circle', ground: false
    });
  }
  let cursor = 0;

  const texts = [];
  const TEXTCAP = 24;

  function obtain() {
    for (let i = 0; i < CAP; i++) {
      const p = pool[cursor];
      cursor = (cursor + 1) % CAP;
      if (!p.alive) return p;
    }
    /* 全满则抢占最老的 */
    const p = pool[cursor];
    cursor = (cursor + 1) % CAP;
    return p;
  }

  function spawn(cfg) {
    const p = obtain();
    p.alive = true;
    p.kind = cfg.kind || 'dot';
    p.x = cfg.x || 0; p.y = cfg.y || 0; p.z = cfg.z || 0;
    p.vx = cfg.vx || 0; p.vy = cfg.vy || 0; p.vz = cfg.vz || 0;
    p.maxLife = p.life = cfg.life || 0.6;
    p.size = cfg.size || 6;
    p.grav = cfg.grav ?? 0;
    p.drag = cfg.drag ?? 1.6;
    p.spin = cfg.spin || 0;
    p.angle = cfg.angle || 0;
    p.color = cfg.color || '#ffffff';
    p.color2 = cfg.color2 || null;
    p.alpha = cfg.alpha ?? 1;
    p.shape = cfg.shape || 'circle';
    p.ground = cfg.ground ?? false;
    p.z += cfg.dz || 0;
    return p;
  }

  /* --------------------------- 预设发射器 ------------------------------- */
  const emit = {
    /** 金币爆开 */
    coinBurst(x, y, z, color = '#ffcc22') {
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2 + Math.random();
        const sp = 1.4 + Math.random() * 2.6;
        spawn({
          kind: 'spark', x, y, z,
          vx: Math.cos(a) * sp * 0.45, vy: 1.6 + Math.random() * 2.6, vz: Math.sin(a) * 0.9,
          life: 0.5 + Math.random() * 0.35, size: 0.055 + Math.random() * 0.07,
          grav: 9, drag: 1.1, color, color2: '#fff6cc', shape: 'star', spin: 8
        });
      }
      spawn({
        kind: 'ring', x, y, z, life: 0.34, size: 0.32, color, alpha: 0.85
      });
    },
    /** 落地 / 脚步扬尘 */
    dust(x, y, z, amount = 5, color = '#d9cdb4') {
      for (let i = 0; i < amount; i++) {
        spawn({
          kind: 'dot', x, y: y + 0.03, z,
          vx: (Math.random() - 0.5) * 3.2, vy: 0.6 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.2,
          life: 0.34 + Math.random() * 0.32, size: 0.09 + Math.random() * 0.16,
          grav: 2.6, drag: 2.4, color, alpha: 0.75, ground: true
        });
      }
    },
    /** 奔跑时身后拖出的尾巴 */
    trail(x, y, z, color) {
      spawn({
        kind: 'dot', x: x + (Math.random() - 0.5) * 0.2, y: y + Math.random() * 0.25, z: z - 0.3,
        vx: 0, vy: 0.3, vz: -1.4, life: 0.28, size: 0.1, color, alpha: 0.5, drag: 1.2
      });
    },
    /** 撞击碎片 */
    crash(x, y, z, color = '#ff5a3c') {
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, e = Math.random() * 1.6;
        spawn({
          kind: 'shard', x, y, z,
          vx: Math.cos(a) * (1.4 + Math.random() * 4), vy: 2 + e * 4, vz: Math.sin(a) * 1.6,
          life: 0.6 + Math.random() * 0.7, size: 0.07 + Math.random() * 0.12,
          grav: 13, drag: 0.6, color, color2: '#2a2f36', shape: 'shard', spin: 12
        });
      }
      spawn({ kind: 'flash', x, y, z, life: 0.22, size: 1.5, color: '#fff', alpha: 0.9 });
    },
    /** 擦身而过的火花 */
    nearMiss(x, y, z) {
      for (let i = 0; i < 7; i++) {
        spawn({
          kind: 'spark', x, y: y + Math.random() * 0.9, z,
          vx: (Math.random() - 0.5) * 1.6, vy: 1 + Math.random() * 2, vz: -0.6,
          life: 0.3 + Math.random() * 0.3, size: 0.05 + Math.random() * 0.05,
          grav: 3, drag: 2, color: i % 2 ? '#fff59a' : '#fff', shape: 'star', spin: 6
        });
      }
    },
    /** 环境雪 / 雨 / 星尘 */
    ambient(x, y, z, color, size) {
      spawn({
        kind: 'dot', x, y, z, vx: (Math.random() - 0.5) * 0.5, vy: -0.5 - Math.random(),
        vz: -0.4, life: 3.4, size, color, alpha: 0.65, drag: 0.1
      });
    },
    /** 道具拾取的光环 */
    powerRing(x, y, z, color) {
      spawn({ kind: 'ring', x, y, z, life: 0.55, size: 1.1, color, alpha: 0.9 });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        spawn({
          kind: 'spark', x, y, z,
          vx: Math.cos(a) * 2.4, vy: 1.4 + Math.random() * 2.2, vz: Math.sin(a) * 1.6,
          life: 0.5 + Math.random() * 0.4, size: 0.06, grav: 4, drag: 1.4,
          color, color2: '#ffffff', shape: 'star', spin: 6
        });
      }
    }
  };

  /* ----------------------------- 飘字 ----------------------------------- */
  function floatText(x, y, content, color = '#fff', size = 1, life = 0.95) {
    if (texts.length >= TEXTCAP) texts.shift();
    texts.push({ x, y, content, color, size, life, maxLife: life, vy: 0, t: 0 });
  }

  /* ----------------------------- 更新 ----------------------------------- */
  function update(dt, worldSpeed) {
    for (let i = 0; i < CAP; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.vy -= p.grav * dt;
      const d = Math.pow(0.5, dt * p.drag);
      p.vx *= d; p.vz *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += (p.vz - worldSpeed * 0.55) * dt;   // 世界向后退
      if (p.ground && p.y < 0.02) { p.y = 0.02; p.vy = Math.abs(p.vy) * 0.28; p.vx *= 0.7; }
      p.angle += p.spin * dt;
      if (p.z < -6 || p.z > 60) p.alive = false;
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      const f = texts[i];
      f.life -= dt; f.t += dt;
      if (f.life <= 0) texts.splice(i, 1);
    }
  }

  /* ----------------------------- 绘制 ----------------------------------- */
  function drawStar(g, r, spikes = 4) {
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.42 : r;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
  }

  function draw(g, camZ) {
    g.save();
    for (let i = 0; i < CAP; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      const pr = project3(p.x, p.y, p.z);
      if (!pr) continue;
      const t = p.life / p.maxLife;
      const px = p.size * NR.unit(p.z);
      if (px < 0.35) continue;
      const alpha = clamp(t * 1.5, 0, 1) * p.alpha;
      if (p.kind === 'ring') {
        const r = px * (1 + (1 - t) * 3.4);
        g.globalAlpha = alpha * t;
        g.strokeStyle = p.color; g.lineWidth = Math.max(1, px * 0.5 * t);
        g.beginPath(); g.ellipse(pr.x, pr.y, r, r * 0.34, 0, 0, Math.PI * 2); g.stroke();
        continue;
      }
      if (p.kind === 'flash') {
        const r = px * (1 + (1 - t) * 2.2);
        g.globalAlpha = alpha * t * 0.9;
        const grad = g.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, Math.max(1, r));
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(0.5, rgba(p.color, 0.5));
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(pr.x, pr.y, Math.max(1, r), 0, Math.PI * 2); g.fill();
        continue;
      }
      g.globalAlpha = alpha;
      g.fillStyle = p.color;
      if (p.shape === 'star') {
        g.save(); g.translate(pr.x, pr.y); g.rotate(p.angle);
        drawStar(g, Math.max(1, px));
        g.fill(); g.restore();
      } else if (p.shape === 'shard') {
        g.save(); g.translate(pr.x, pr.y); g.rotate(p.angle);
        g.beginPath();
        g.moveTo(-px, -px * 0.5); g.lineTo(px * 0.9, -px * 0.9);
        g.lineTo(px, px * 0.6); g.lineTo(-px * 0.7, px);
        g.closePath();
        if (p.color2) {
          const grad = g.createLinearGradient(-px, -px, px, px);
          grad.addColorStop(0, p.color); grad.addColorStop(1, p.color2);
          g.fillStyle = grad; g.fillStyle = grad;
        }
        g.fill(); g.restore();
      } else {
        const r = Math.max(0.6, px);
        if (px > 3.5) {
          const grad = g.createRadialGradient(pr.x - r * 0.3, pr.y - r * 0.3, 0, pr.x, pr.y, r);
          grad.addColorStop(0, p.color2 || '#ffffff');
          grad.addColorStop(1, p.color);
          g.fillStyle = grad;
        }
        g.beginPath(); g.arc(pr.x, pr.y, r, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function drawTexts(g) {
    if (!texts.length) return;
    g.save();
    g.textAlign = 'center';
    for (const f of texts) {
      const pr = project(f.x, f.z);
      if (!pr) continue;
      const t = 1 - f.life / f.maxLife;
      const rise = (1 - Math.pow(1 - t, 3)) * 130;
      const scale = NR.clamp(1 - Math.pow(t, 3) * 0.35, 0.2, 1.4) * (0.9 + f.size * 0.55) * (0.5 + pr.s * 0.75);
      const alpha = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      const size = Math.max(11, 30 * scale);
      g.globalAlpha = alpha;
      g.font = `900 ${size}px "Microsoft YaHei", system-ui, sans-serif`;
      g.lineWidth = Math.max(2, size * 0.16);
      g.strokeStyle = 'rgba(20,24,30,0.62)';
      g.strokeText(f.content, pr.x, pr.y - rise);
      g.fillStyle = f.color;
      g.fillText(f.content, pr.x, pr.y - rise);
    }
    g.restore();
  }

  function clear() {
    for (const p of pool) p.alive = false;
    texts.length = 0;
  }

  function count() {
    let n = 0;
    for (let i = 0; i < CAP; i++) if (pool[i].alive) n++;
    return n;
  }

  NR.particles = { spawn, emit, floatText, update, draw, drawTexts, clear, count, texts };
})();

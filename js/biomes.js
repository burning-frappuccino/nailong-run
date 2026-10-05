/* ============================================================================
 * 奶龙跑酷 · 主题层
 * 五个渐进的场景主题 + 调色板插值 + 环境装饰绘制（山脊 / 城市 / 星空 / 沙丘）
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const { clamp, lerp, mixHex, rgba, smooth, makeRng, noise1, project } = NR;
  const T = NR.T;

  const BIOMES = [
    {
      key: 'city', name: '城市街道', emoji: '🏙',
      sky: ['#57c4ef', '#93dcf6', '#dff3fb', '#eaf7ff'],
      haze: '#dff3fb', sun: '#fff6b4', sunGlow: '#ffe680',
      ground: '#6dbe58', groundAlt: '#5aa949', groundFar: '#8dcb7e',
      road: '#41474f', roadAlt: '#4b525b', dash: '#f7f2d0',
      shoulder: '#cfc4ab', fog: '#e7f4fb',
      silhouette: '#8399a8', silhouette2: '#6c8496', lamp: '#fff0c0',
      accent: '#ffb400', accent2: '#ff7a45', coin: '#ffc400',
      ambient: null, decor: 'city'
    },
    {
      key: 'night', name: '霓虹夜市', emoji: '🌃',
      sky: ['#0d1330', '#1e2450', '#3a2c5c', '#6a3a63'],
      haze: '#3a2c5c', sun: '#ffe9a8', sunGlow: '#ffb46b',
      ground: '#232a44', groundAlt: '#1b2136', groundFar: '#333c5e',
      road: '#191d2b', roadAlt: '#202536', dash: '#ffd166',
      shoulder: '#2a3048', fog: '#2b2f52',
      silhouette: '#161a30', silhouette2: '#101326', lamp: '#ff9de2', accent: '#ff4d9d', accent2: '#5ce1e6',
      coin: '#ffd166', ambient: { color: '#ffe9a8', rate: 1.1, size: 0.035, kind: 'dot' }, decor: 'city'
    },
    {
      key: 'desert', name: '沙漠峡谷', emoji: '🏜',
      sky: ['#3fa9dd', '#8fd3ea', '#ffe0b0', '#ffd092'],
      haze: '#ffe0b0', sun: '#fff1c4', sunGlow: '#ffb75e',
      ground: '#e0bb7f', groundAlt: '#cfa96c', groundFar: '#efd7a8',
      road: '#786049', roadAlt: '#84694f', dash: '#ffeec2',
      shoulder: '#f0d9a8', fog: '#ffe6ba',
      silhouette: '#c99a63', silhouette2: '#a87c4c', lamp: '#ffd9a0', accent: '#ff8a3d', accent2: '#ffd166',
      coin: '#ffc400', ambient: { color: '#e8cf9a', rate: 2.6, size: 0.05, kind: 'dot' }, decor: 'mesa'
    },
    {
      key: 'snow', name: '雪原赛道', emoji: '❄️',
      sky: ['#7fb6dd', '#a9cfe8', '#dceaf3', '#f2f8fb'],
      haze: '#dceaf3', sun: '#ffffff', sunGlow: '#dcefff',
      ground: '#eef4f8', groundAlt: '#dde8f0', groundFar: '#ffffff',
      road: '#6f7d8a', roadAlt: '#7b8996', dash: '#ffffff',
      shoulder: '#f4f9fc', fog: '#eaf3f9',
      silhouette: '#b8cbd9', silhouette2: '#98b0c2', lamp: '#dfefff', accent: '#4fc3f7', accent2: '#b3e5fc',
      coin: '#ffc400', ambient: { color: '#ffffff', rate: 8, size: 0.045, kind: 'snow' }, decor: 'peak'
    },
    {
      key: 'space', name: '星海轨道', emoji: '🌌',
      sky: ['#05030f', '#110b2c', '#26124a', '#4a1b62'],
      haze: '#26124a', sun: '#cfe8ff', sunGlow: '#7b6bff',
      ground: '#191436', groundAlt: '#120f2a', groundFar: '#241a48',
      road: '#16132c', roadAlt: '#1d1839', dash: '#9fe8ff',
      shoulder: '#221c46', fog: '#1d1440',
      silhouette: '#0d0a20', silhouette2: '#080614', lamp: '#7b6bff', accent: '#5ce1e6', accent2: '#b388ff',
      coin: '#9fe8ff', ambient: { color: '#cfe8ff', rate: 5, size: 0.035, kind: 'star' }, decor: 'space'
    }
  ];

  const hexKeys = ['haze', 'sun', 'sunGlow', 'ground', 'groundAlt', 'groundFar', 'road', 'roadAlt',
    'dash', 'shoulder', 'fog', 'silhouette', 'silhouette2', 'lamp', 'accent', 'accent2', 'coin'];

  function mixPalette(a, b, t) {
    const out = {};
    for (const k of hexKeys) out[k] = mixHex(a[k], b[k], t);
    out.sky = a.sky.map((c, i) => mixHex(c, b.sky[i], t));
    out.decor = t < 0.5 ? a.decor : b.decor;
    out.name = t < 0.5 ? a.name : b.name;
    out.emoji = t < 0.5 ? a.emoji : b.emoji;
    out.key = t < 0.5 ? a.key : b.key;
    out.ambient = t < 0.5 ? a.ambient : b.ambient;
    return out;
  }

  /** 根据跑动距离取当前主题（含过渡混合） */
  function paletteAt(distance) {
    const span = T.biomeEvery, x = distance / span;
    const idx = Math.floor(x), frac = x - idx;
    const a = BIOMES[((idx % BIOMES.length) + BIOMES.length) % BIOMES.length];
    const b = BIOMES[(((idx + 1) % BIOMES.length) + BIOMES.length) % BIOMES.length];
    /* 只有最后 14% 路程才做过渡，中间保持主题纯正 */
    const t = frac > 0.86 ? smooth(clamp((frac - 0.86) / 0.14, 0, 1)) : 0;
    const pal = mixPalette(a, b, t);
    pal.progress = frac;
    pal.index = idx;
    pal.next = b;
    return pal;
  }

  function biomeIndex(distance) {
    return Math.floor(distance / T.biomeEvery) % BIOMES.length;
  }

  /* ========================== 环境装饰绘制 ============================== */
  /* 每类装饰都用离屏画布缓存（按宽度分段 + 主题色），滚屏时只做 drawImage。 */

  function drawCity(g, VW, VH, pal, scroll, horizon) {
    const layers = [
      { scale: 0.55, alpha: 0.5, color: pal.silhouette, y: horizon + 6, seg: 520 },
      { scale: 1.0, alpha: 0.92, color: pal.silhouette2, y: horizon + 12, seg: 760 }
    ];
    for (let L = 0; L < layers.length; L++) {
      const cfg = layers[L];
      const key = `city|${pal.key}|${L}|${VW}`;
      const sc = NR.scratch(key, VW + cfg.seg, 260, 1);
      const cg = sc.ctx;
      const rng = makeRng(9182 + L * 77);
      cg.globalAlpha = cfg.alpha;
      let x = -40;
      while (x < VW + cfg.seg) {
        const w = rng.range(46, 118) * cfg.scale;
        const h = rng.range(60, 190) * cfg.scale;
        const y = 260 - h;
        cg.fillStyle = cfg.color;
        cg.fillRect(x, y, w, h);
        /* 屋顶小结构 */
        if (rng.chance(0.32)) cg.fillRect(x + w * 0.3, y - rng.range(8, 22) * cfg.scale, w * 0.22, rng.range(8, 22) * cfg.scale);
        /* 窗户 */
        cg.fillStyle = pal.lamp;
        const cw = Math.max(3, 6 * cfg.scale), ch = Math.max(4, 8 * cfg.scale);
        const cols = Math.max(1, Math.floor((w - 10) / (cw * 2.1)));
        const rows = Math.max(1, Math.floor((h - 14) / (ch * 2.1)));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (!rng.chance(0.62)) continue;
            cg.globalAlpha = cfg.alpha * rng.range(0.5, 1);
            cg.fillRect(x + 6 + c * cw * 2.1, y + 9 + r * ch * 2.1, cw, ch);
          }
        }
        cg.globalAlpha = cfg.alpha;
        x += w + rng.range(6, 26);
      }
      const off = -((scroll * (0.08 + L * 0.16)) % (VW + cfg.seg));
      g.drawImage(sc.canvas, off, cfg.y - 260);
    }
  }

  function drawMesa(g, VW, VH, pal, scroll, horizon) {
    const rng = makeRng(4477);
    const key = `mesa|${pal.key}|${VW}`;
    const sc = NR.scratch(key, VW + 640, 300, 1);
    const cg = sc.ctx;
    const base = 300;
    /* 两层台地 */
    for (let L = 0; L < 2; L++) {
      const alpha = L === 0 ? 0.42 : 1;
      const hMul = L === 0 ? 0.55 : 1;
      cg.globalAlpha = alpha;
      cg.fillStyle = L === 0 ? pal.silhouette : pal.silhouette2;
      cg.beginPath();
      cg.moveTo(-20, base);
      let x = -20;
      while (x < VW + 640) {
        const w = rng.range(90, 240);
        const h = rng.range(70, 200) * hMul;
        const shoulder = rng.range(0.15, 0.35);
        cg.lineTo(x, base - h * (1 - shoulder));
        cg.lineTo(x + w * 0.16, base - h);
        cg.lineTo(x + w * 0.84, base - h);
        cg.lineTo(x + w, base - h * (1 - shoulder));
        x += w + rng.range(20, 90);
      }
      cg.lineTo(VW + 640, base);
      cg.closePath();
      cg.fill();
    }
    const off = -((scroll * 0.1) % (VW + 640));
    g.drawImage(sc.canvas, off, horizon - 250);
  }

  function drawPeak(g, VW, VH, pal, scroll, horizon) {
    const rng = makeRng(7781);
    const key = `peak|${pal.key}|${VW}`;
    const sc = NR.scratch(key, VW + 720, 340, 1);
    const cg = sc.ctx;
    const base = 340;
    for (let L = 0; L < 2; L++) {
      cg.globalAlpha = L === 0 ? 0.45 : 1;
      const hMul = L === 0 ? 0.62 : 1;
      cg.fillStyle = L === 0 ? pal.silhouette : pal.silhouette2;
      cg.beginPath();
      cg.moveTo(-20, base);
      let x = -20;
      while (x < VW + 720) {
        const w = rng.range(140, 300);
        const h = rng.range(120, 280) * hMul;
        const peakX = x + w * rng.range(0.3, 0.7);
        cg.lineTo(x, base - h * 0.25);
        cg.lineTo(peakX, base - h);
        /* 雪顶 */
        cg.lineTo(peakX + w * 0.16, base - h * 0.72);
        cg.lineTo(x + w, base - h * 0.3);
        x += w + rng.range(30, 120);
      }
      cg.lineTo(VW + 720, base);
      cg.closePath();
      cg.fill();
      /* 雪线高光 */
      if (L === 1) {
        cg.globalAlpha = 0.75;
        cg.fillStyle = '#ffffff';
        let sx = -20;
        while (sx < VW + 720) {
          const w = rng.range(140, 300);
          const h = rng.range(120, 280);
          const peakX = sx + w * 0.5;
          cg.beginPath();
          cg.moveTo(peakX - w * 0.16, base - h * 0.78);
          cg.lineTo(peakX, base - h);
          cg.lineTo(peakX + w * 0.16, base - h * 0.72);
          cg.closePath();
          cg.fill();
          sx += w + rng.range(30, 120);
        }
      }
    }
    const off = -((scroll * 0.09) % (VW + 720));
    g.drawImage(sc.canvas, off, horizon - 300);
  }

  function drawSpace(g, VW, VH, pal, scroll, horizon) {
    const key = `space|${VW}x${Math.round(horizon)}`;
    const sc = NR.scratch(key, VW, Math.max(60, horizon + 40), 1);
    const cg = sc.ctx;
    const rng = makeRng(31337);
    const H = Math.max(60, horizon + 40);
    for (let i = 0; i < 220; i++) {
      const x = rng() * VW, y = rng() * H;
      const r = rng.range(0.4, 1.7);
      cg.globalAlpha = rng.range(0.25, 1);
      cg.fillStyle = rng.chance(0.15) ? '#9fe8ff' : rng.chance(0.2) ? '#ffd1f0' : '#ffffff';
      cg.beginPath(); cg.arc(x, y, r, 0, Math.PI * 2); cg.fill();
    }
    /* 星云带 */
    cg.globalAlpha = 0.22;
    const grad = cg.createLinearGradient(0, H * 0.1, VW, H * 0.8);
    grad.addColorStop(0, 'rgba(120,80,255,0)');
    grad.addColorStop(0.45, 'rgba(150,90,255,0.55)');
    grad.addColorStop(0.7, 'rgba(90,200,255,0.35)');
    grad.addColorStop(1, 'rgba(255,120,200,0)');
    cg.fillStyle = grad;
    cg.beginPath();
    cg.moveTo(0, H * 0.72);
    cg.bezierCurveTo(VW * 0.3, H * 0.1, VW * 0.7, H * 0.95, VW, H * 0.3);
    cg.lineTo(VW, H * 0.62);
    cg.bezierCurveTo(VW * 0.7, H * 1.1, VW * 0.3, H * 0.5, 0, H);
    cg.closePath();
    cg.fill();
    /* 行星 */
    const pr = Math.min(VW, VH) * 0.075;
    const px = VW * 0.79, py = horizon * 0.42;
    const pg = cg.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, '#cfe8ff'); pg.addColorStop(0.6, '#7b6bff'); pg.addColorStop(1, '#3a2a80');
    cg.globalAlpha = 1;
    cg.fillStyle = pg;
    cg.beginPath(); cg.arc(px, py, pr, 0, Math.PI * 2); cg.fill();
    /* 光环 */
    cg.save();
    cg.translate(px, py); cg.rotate(-0.42); cg.scale(1, 0.26);
    cg.globalAlpha = 0.75;
    cg.strokeStyle = '#b388ff'; cg.lineWidth = Math.max(1.5, pr * 0.14);
    cg.beginPath(); cg.arc(0, 0, pr * 1.55, 0, Math.PI * 2); cg.stroke();
    cg.restore();
    g.drawImage(sc.canvas, 0, 0);
  }

  const DECOR = { city: drawCity, mesa: drawMesa, peak: drawPeak, space: drawSpace };

  function drawDecor(g, VW, VH, pal, scroll, horizon) {
    const fn = DECOR[pal.decor] || drawCity;
    fn(g, VW, VH, pal, scroll, horizon);
  }

  NR.biomes = { list: BIOMES, paletteAt, biomeIndex, drawDecor, mixPalette };
})();

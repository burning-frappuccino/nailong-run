/* ============================================================================
 * 奶龙跑酷 · 工具层
 * 数学 / 随机数 / 颜色 / 透视投影 / 离屏画布 —— 全部挂在 NR 上。
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const T = NR.T;

  /* ----------------------------- 数学 ------------------------------------ */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const smooth = t => t * t * (3 - 2 * t);
  const smoother = t => t * t * t * (t * (t * 6 - 15) + 10);
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeOutBack = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
  /** 帧率无关的指数逼近 */
  const damp = (cur, target, halfLife, dt) =>
    target + (cur - target) * Math.pow(0.5, dt / Math.max(halfLife, 1e-5));
  const dist2 = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
  const pulse = (t, period) => (t % period) / period;

  /* --------------------------- 随机数 ----------------------------------- */
  /** mulberry32：可复现随机，配合 ?seed= 复现同一套关卡 */
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    const rng = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.range = (lo, hi) => lo + rng() * (hi - lo);
    rng.int = (lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
    rng.pick = arr => arr[Math.floor(rng() * arr.length)];
    rng.chance = p => rng() < p;
    rng.sign = () => (rng() < 0.5 ? -1 : 1);
    rng.shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    };
    return rng;
  }

  /* ---------------------------- 颜色 ------------------------------------ */
  const hexToRgb = hex => {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgbToHex = (r, g, b) =>
    '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const mixHex = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
  };
  const rgba = (hex, alpha) => {
    const c = hexToRgb(hex);
    return `rgba(${c[0]},${c[1]},${c[2]},${clamp(alpha, 0, 1)})`;
  };
  /** amount > 0 提亮，< 0 压暗 */
  const shade = (hex, amount) => {
    const c = hexToRgb(hex);
    if (amount >= 0) return rgbToHex(lerp(c[0], 255, amount), lerp(c[1], 255, amount), lerp(c[2], 255, amount));
    return rgbToHex(c[0] * (1 + amount), c[1] * (1 + amount), c[2] * (1 + amount));
  };

  /* ======================== 透视投影 ====================================
   * 世界坐标：
   *   x → 右为正，0 = 路中心
   *   y → 离地高度为正
   *   z → 前方为正；角色固定在 z = playerZ
   *
   * 地面用幂律映射连接「屏幕行」与「世界距离」——跑酷类游戏的标准做法：
   *
   *   t(y) = (y − fy)/(H − fy) ∈ [0,1]      0 在地平线，1 在屏幕下缘
   *   depth(t) = zReach·(1 − t)^γ − zBack   γ>1 时近处行距拉大
   *   unit  = K/(aScale + depth)            1 世界单位 = 多少像素
   *
   * 三个基准点：
   *   depth(0)  = zReach − zBack   地平线方向的可视距离
   *   depth(tP) = 0                角色脚部精确落在 feetRatio 处
   *   depth(1)  = −zBack           屏幕下缘在角色身后多远
   *
   * 关键：unit 是 depth 的严格递减函数（近大远小），
   * depth 是 t 的严格递减函数（越靠上越远），两者一起
   * 保证整条路都不会出现「近小远大」的倒错。
   * ==================================================================== */
  let VW = 0, VH = 0;
  const view = {
    w: 0, h: 0, horizon: 0, feetY: 0, unit0: 0, zNear: 0, zFar: 0, span: 1,
    horizonRatio: 0, feetRatio: 0, tP: 0, uP: 0, gamma: 1.4, zBack: 1, zReach: 1, aScale: 1, K: 1
  };

  /** 屏幕参数 t → 地面深度（相对角色 z 的偏移，角色处恒为 0）
   *   depth = zReach·[(1−t)^γ − (1−tP)^γ]
   *   t = 0 → 地平线方向最远；t = tP → 0（角色脚下）；t = 1 → 负值（身后） */
  const depthOfT = t => {
    const u = Math.max(1 - t, 0);
    return view.zReach * (Math.pow(u, view.gamma) - view.uP);
  };
  /** 地面深度 → 屏幕参数 t（闭合解）
   *   1 − t = [ (1−tP)^γ + depth/zReach ]^(1/γ) */
  const tOfDepth = d => {
    const u = Math.max(view.uP + d / view.zReach, 0);
    return 1 - Math.pow(u, 1 / view.gamma);
  };

  function setViewport(w, h) {
    if (!(w > 0) || !(h > 0)) return;
    VW = w; VH = h;
    const span = h - h * T.horizon;
    const tP = clamp((h * T.feetRatio - h * T.horizon) / span, 0.02, 0.995);
    view.w = w; view.h = h;
    view.span = span;
    view.horizon = h * T.horizon;
    view.horizonRatio = T.horizon;
    view.feetY = h * T.feetRatio;
    view.feetRatio = T.feetRatio;
    view.tP = tP;
    view.gamma = Math.max(1.02, T.gamma);
    view.zBack = Math.max(0.2, T.zBack);
    view.zReach = view.zBack + Math.max(20, T.zFarP);
    view.uP = Math.pow(Math.max(1 - tP, 1e-6), view.gamma);
    view.zNear = depthOfT(1);
    view.zFar = depthOfT(0);
    /* 角色处 1 世界单位 = charHeight·屏高 / spriteH 像素 */
    const targetPx = Math.max(16, h * T.charHeight);
    view.unit0 = targetPx / T.spriteH;
    /* 尺度衰减：unit = K/(aScale + depth)，角色处 depth = 0 ⇒ K = unit0·aScale。
     * aScale 是「有效视距」（米）：越大远处缩得越慢、越平。
     * 直接给绝对值比用比例反推可控得多。 */
    view.aScale = Math.max(0.5, T.falloff);
    view.K = view.unit0 * view.aScale;
    view.charPx = targetPx;
  }

  /** 屏幕行 → t（0 = 地平线，1 = 屏幕下缘） */
  const tAtRow = y => clamp((y - view.horizon) / Math.max(VH - view.horizon, 1e-6), 0, 1);
  /** 地面深度 → 该处 1 世界单位对应多少像素 */
  const unitOfDepth = d => view.K / (view.aScale + Math.max(d, view.zNear));
  /** 世界 z → 地面深度（相对角色 z 的偏移） */
  const zToDepth = z => z - T.playerZ;
  const depthToZ = d => d + T.playerZ;
  /** 世界 z 处 1 世界单位对应多少像素 */
  const unit = z => unitOfDepth(zToDepth(z));
  /** 世界高度 h 在深度 z 处的像素高度 */
  const worldToPx = (h, z) => h * unit(z);
  /** 归一化「远近程度」：角色处 = 1（雾化 / 淡出用） */
  const sv = z => {
    const u = unit(z);
    return u <= 0 ? 0 : Math.min(1, u / view.unit0);
  };
  /** 地面点 (x, z) → {x, y, u, s, t} */
  function project(x, z) {
    const d = zToDepth(z);
    if (d <= view.zNear) return null;              // 摄像机身后
    const t = tOfDepth(d);
    if (!(t >= 0) || t >= 1) return null;          // 地平线之外
    const u = unitOfDepth(d);
    return { x: VW * 0.5 + x * u, y: view.horizon + view.span * t, s: u, u, t, depth: d };
  }
  /** 世界点 (x, y, z) → {x, y, u, s, t} */
  function project3(x, y, z) {
    const g = project(x, z);
    if (!g) return null;
    g.y -= y * g.u * T.rise;
    return g;
  }
  /** 由屏幕纵坐标反解该处的地面世界 z（闭合解，无误差） */
  const zAtRow = y => depthToZ(depthOfT(tAtRow(y)));
  /** 世界 z 对应的屏幕纵坐标（地面） */
  function rowOfZ(z) {
    const g = project(0, z);
    return g ? g.y : view.horizon;
  }

  /* ----------------------- Canvas2D 兼容垫片 --------------------------- */
  /* roundRect 是 Chrome/Edge 99+ 才有的。这里补一个等价实现，
   * 免得用户的浏览器稍旧一点，画列车时就整段报错。 */
  if (typeof CanvasRenderingContext2D !== 'undefined' &&
      !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      let rad = typeof r === 'number' ? r : (Array.isArray(r) ? r[0] : 0);
      rad = Math.min(Math.abs(rad), Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + rad, y);
      this.lineTo(x + w - rad, y);
      this.quadraticCurveTo(x + w, y, x + w, y + rad);
      this.lineTo(x + w, y + h - rad);
      this.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      this.lineTo(x + rad, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - rad);
      this.lineTo(x, y + rad);
      this.quadraticCurveTo(x, y, x + rad, y);
      return this;
    };
  }

  /* ------------------------- 离屏画布池 -------------------------------- */
  const pool = new Map();
  /** 取一块可复用画布，key 相同则复用（尺寸变化时自动重建） */
  function scratch(key, w, h, dpr = 1) {
    let c = pool.get(key);
    const pw = Math.max(1, Math.ceil(w * dpr));
    const ph = Math.max(1, Math.ceil(h * dpr));
    if (!c) { c = document.createElement('canvas'); pool.set(key, c); }
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { canvas: c, ctx: g, w, h };
  }

  /* --------------------------- 杂项 ------------------------------------ */
  const now = () => performance.now();
  const fmt = n => Math.round(n).toLocaleString('zh-CN');
  /** 按固定种子做 1D 值噪声，用于山脊 / 星空等程序化生成 */
  function noise1(seed) {
    const rng = makeRng(seed);
    const N = 256, tab = new Float32Array(N);
    for (let i = 0; i < N; i++) tab[i] = rng();
    return x => {
      const i = Math.floor(x), f = x - i;
      const a = tab[((i % N) + N) % N], b = tab[(((i + 1) % N) + N) % N];
      return lerp(a, b, smooth(f));
    };
  }

  Object.assign(NR, {
    clamp, lerp, invLerp, smooth, smoother, easeOutCubic, easeOutBack,
    approach, damp, dist2, pulse, makeRng, noise1,
    hexToRgb, rgbToHex, mixHex, rgba, shade,
    setViewport, view, sv, tAtRow, zToDepth, depthToZ, depthOfT, tOfDepth, unitOfDepth,
    project, project3, unit, worldToPx, zAtRow, rowOfZ, scratch,
    now, fmt
  });
})();

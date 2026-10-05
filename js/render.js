/* ============================================================================
 * 奶龙跑酷 · 渲染层
 * 透视路面 / 天空 / 路旁景物 / 障碍物 / 道具 / 角色 —— 全部按统一针孔投影绘制。
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const {
    clamp, lerp, mixHex, rgba, shade, project, project3, unit, sv,
    smooth, makeRng, scratch
  } = NR;
  const T = NR.T;
  const PI2 = Math.PI * 2;

  /* --------------------------- 静态状态 ---------------------------------- */
  let scroll = 0;          // 累计滚屏（世界单位）
  let roadTexKey = '';
  let roadTexCanvas = null;

  const resetScroll = () => { scroll = 0; };

  /* ------------------------------ 天空 ---------------------------------- */
  function drawSky(g, VW, VH, pal, time) {
    const yH = NR.view.horizon;
    const grad = g.createLinearGradient(0, -VH * 0.06, 0, yH + 4);
    grad.addColorStop(0, pal.sky[0]);
    grad.addColorStop(0.42, pal.sky[1]);
    grad.addColorStop(0.78, pal.sky[2]);
    grad.addColorStop(1, pal.sky[3]);
    g.fillStyle = grad;
    g.fillRect(0, -VH * 0.06, VW, yH + VH * 0.06 + 4);

    const isNight = pal.key === 'night' || pal.key === 'space';

    /* 太阳 / 月亮 + 光晕 */
    const sunX = VW * 0.78, sunY = yH * 0.34;
    const sunR = Math.min(VW, VH) * 0.052;
    const glow = g.createRadialGradient(sunX, sunY, sunR * 0.4, sunX, sunY, sunR * 5.4);
    glow.addColorStop(0, rgba(pal.sunGlow, isNight ? 0.4 : 0.55));
    glow.addColorStop(0.4, rgba(pal.sunGlow, isNight ? 0.12 : 0.18));
    glow.addColorStop(1, rgba(pal.sunGlow, 0));
    g.fillStyle = glow;
    g.beginPath(); g.arc(sunX, sunY, sunR * 5.4, 0, PI2); g.fill();
    g.fillStyle = pal.sun;
    g.beginPath(); g.arc(sunX, sunY, sunR, 0, PI2); g.fill();
    if (isNight) {
      /* 月牙：用背景色挖掉一块 */
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(sunX + sunR * 0.55, sunY - sunR * 0.3, sunR * 0.88, 0, PI2); g.fill();
      g.globalCompositeOperation = 'source-over';
    }

    /* 云 / 星尘（视差滚动） */
    const rng = makeRng(20482);
    const layer = scratch(`clouds|${VW}|${Math.round(yH)}`, VW + 520, Math.max(40, yH * 0.8), 1);
    const cg = layer.ctx;
    const count = 7;
    for (let i = 0; i < count; i++) {
      const cx = rng() * (VW + 520), cy = rng.range(10, yH * 0.62);
      const s = rng.range(0.6, 1.5);
      const alpha = rng.range(0.22, 0.6);
      cg.globalAlpha = alpha;
      const clouds = 5;
      for (let k = 0; k < clouds; k++) {
        const ox = (k - 2) * 26 * s, oy = Math.sin(k) * 7 * s;
        const rx = (34 + Math.cos(k * 1.7) * 12) * s, ry = (15 + Math.sin(k * 2.1) * 5) * s;
        const cgrad = cg.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rx);
        const tint = isNight ? '#8f9ee0' : '#ffffff';
        cgrad.addColorStop(0, rgba(tint, 0.95));
        cgrad.addColorStop(0.6, rgba(tint, 0.5));
        cgrad.addColorStop(1, rgba(tint, 0));
        cg.fillStyle = cgrad;
        cg.beginPath(); cg.ellipse(cx + ox, cy + oy, rx, ry, 0, 0, PI2); cg.fill();
      }
    }
    const off = -((scroll * 0.9) % (VW + 520));
    g.drawImage(layer.canvas, off, 0);
    g.drawImage(layer.canvas, off + VW + 520, 0);
  }

  /* ------------------------------ 地面 ---------------------------------- */
  function drawGround(g, VW, VH, pal) {
    const yH = NR.view.horizon;
    const grad = g.createLinearGradient(0, yH, 0, VH);
    grad.addColorStop(0, pal.groundFar);
    grad.addColorStop(0.14, pal.ground);
    grad.addColorStop(1, pal.groundAlt);
    g.fillStyle = grad;
    g.fillRect(0, yH, VW, VH - yH);
  }

  /* ------------------------------ 路面 ---------------------------------- */
  function buildRoadTexture(pal) {
    const key = `road|${pal.road}|${pal.roadAlt}`;
    if (key === roadTexKey) return roadTexCanvas;
    roadTexKey = key;
    const W = 96, H = 384;
    const s = scratch('roadtex', W, H, 1);
    const c = s.ctx;
    c.fillStyle = pal.road;
    c.fillRect(0, 0, W, H);
    const rng = makeRng(5150);
    /* 横向色带，模拟沥青铺装接缝 */
    for (let i = 0; i < 46; i++) {
      const y = rng() * H, h = rng.range(2, 11);
      c.globalAlpha = rng.range(0.05, 0.2);
      c.fillStyle = rng.chance(0.5) ? pal.roadAlt : shade(pal.road, rng.chance(0.5) ? 0.1 : -0.12);
      c.fillRect(0, y, W, h);
    }
    /* 颗粒 */
    c.globalAlpha = 1;
    for (let i = 0; i < 2600; i++) {
      const x = rng() * W, y = rng() * H;
      c.globalAlpha = rng.range(0.05, 0.3);
      c.fillStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
      c.fillRect(x, y, rng.range(0.6, 1.8), rng.range(0.6, 1.8));
    }
    c.globalAlpha = 1;
    roadTexCanvas = s.canvas;
    return roadTexCanvas;
  }

  /* ------------------------------------------------------------------ *
   * 路面
   * 逐屏幕行把 y 反解成世界深度 z，再把世界坐标投影成屏幕梯形。
   * 纹理纵向 UV 由深度直接推出，随 scroll 滚动。
   * ------------------------------------------------------------------ */
  const ROAD_STEPS = 86;
  const SHOULDER_FAR = 34;   // 路肩向外铺多远（世界单位）

  function drawRoad(g, VW, VH, pal, speedRatio) {
    const yH = NR.view.horizon;
    const tex = buildRoadTexture(pal);
    const tw = tex.width, th = tex.height;
    const hw = T.roadHalf;
    const span = T.texSpan;
    const frac = ((scroll / span) % 1 + 1) % 1;
    const XM = 4;                       // 允许溢出画布的安全边距
    const xLo = -XM, xHi = VW + XM;

    /* 屏幕行分布：地平线附近密、近处疏。所有 y 都留在画布内。 */
    const yTop = yH + 0.5, yBottom = VH - 0.5;
    const ys = new Float64Array(ROAD_STEPS + 1);
    for (let i = 0; i <= ROAD_STEPS; i++) {
      ys[i] = lerp(yBottom, yTop, Math.pow(i / ROAD_STEPS, 0.72));
    }
    const zs = new Float64Array(ROAD_STEPS + 1);
    const xs = new Float64Array(ROAD_STEPS + 1);
    for (let i = 0; i <= ROAD_STEPS; i++) {
      const z = NR.zAtRow(ys[i]);
      zs[i] = z;
      const q = NR.project(hw, z);
      /* 路缘 x 夹在画布内：远处半宽会算到上万像素 */
      xs[i] = clamp(q ? q.x - VW / 2 : 0, 0, VW / 2 + XM);
    }

    /* ---------- 1. 路肩：整屏地面渐变 ---------- */
    const sg = g.createLinearGradient(0, yH, 0, VH);
    sg.addColorStop(0, mixHex(pal.shoulder, pal.fog, 0.45));
    sg.addColorStop(0.08, pal.shoulder);
    sg.addColorStop(0.55, shade(pal.shoulder, -0.05));
    sg.addColorStop(1, shade(pal.shoulder, -0.14));
    g.fillStyle = sg;
    g.fillRect(0, yH, VW, VH - yH);

    /* ---------- 2. 路面 ----------
     * 路缘几何上会在角色身后收拢（屏幕下缘那段本来就在镜头外），
     * 直接照搬会让屏幕底部空出两块草皮、还留下一道硬台阶。
     * 做法：
     *   · 主体多边形只画到路缘离开画面的那一行（yCross），
     *     以下用「从 yCross 一路铺到画框左右下角」的裙边补齐。
     *   · 所有顶点留在画布内 —— 顶点跑到画布外会让 canvas 填充算错。 */
    const spread = new Float64Array(ROAD_STEPS + 1);
    let yCross = ys[0];
    let crossL = VW / 2 - xs[0], crossR = VW / 2 + xs[0];
    {
      let ci = -1;
      for (let i = 1; i <= ROAD_STEPS; i++) {
        if (xs[i] >= VW / 2 - 1) { ci = i; break; }
      }
      if (ci > 0) {
        yCross = ys[ci - 1];
        crossL = VW / 2 - xs[ci - 1];
        crossR = VW / 2 + xs[ci - 1];
      } else {
        yCross = ys[ROAD_STEPS];
        crossL = xLo; crossR = xHi;
      }
      for (let i = 0; i <= ROAD_STEPS; i++) spread[i] = i >= ci && ci > 0 ? VW / 2 + XM : xs[i];
    }
    g.fillStyle = pal.road;
    /* 裙边先铺，保证底部左右下角也是路面 */
    if (yCross < VH) {
      g.beginPath();
      g.moveTo(crossL, yCross); g.lineTo(crossR, yCross);
      g.lineTo(xHi, VH); g.lineTo(xLo, VH);
      g.closePath();
      g.fill();
    }
    /* 主体 */
    g.beginPath();
    g.moveTo(xLo, yCross);
    for (let i = 0; i <= ROAD_STEPS; i++) g.lineTo(VW / 2 - spread[i], ys[i]);
    for (let i = ROAD_STEPS; i >= 0; i--) g.lineTo(VW / 2 + spread[i], ys[i]);
    g.lineTo(xHi, yCross);
    g.closePath();
    g.fill();

    /* ---------- 3. 路面纹理：逐条梯形，用 save/clip 限制范围 ---------- */
    for (let i = 0; i < ROAD_STEPS; i++) {
      const yA = ys[i], yB = ys[i + 1];
      const hA = spread[i], hB = spread[i + 1];
      if (Math.max(hA, hB) < 0.6) continue;
      const zMid = Math.sqrt(Math.max(zs[i], 0.01) * Math.max(zs[i + 1], 0.01));
      let v = (zMid / span) - frac;
      v -= Math.floor(v);
      const sy = clamp((1 - v) * th, 0, th - 2);
      const sh = clamp(th * (T.texStep / span), 2, th - sy);
      const xlA = clamp(VW / 2 - hA, xLo, xHi), xrA = clamp(VW / 2 + hA, xLo, xHi);
      const xlB = clamp(VW / 2 - hB, xLo, xHi), xrB = clamp(VW / 2 + hB, xLo, xHi);
      g.save();
      g.beginPath();
      g.moveTo(xlA, yA); g.lineTo(xrA, yA); g.lineTo(xrB, yB); g.lineTo(xlB, yB);
      g.closePath();
      g.clip();
      g.drawImage(tex, 0, sy, tw, sh,
        Math.min(xlA, xlB), Math.min(yA, yB) - 0.6,
        Math.max(xrA, xrB) - Math.min(xlA, xlB), Math.abs(yA - yB) + 1.2);
      /* 只在真正远的地方叠雾：角色处 sv≈1，阈值必须明显低于它。
       * 用平方衰减，避免地平线附近出现一条生硬的色带。 */
      const fogT = clamp((0.5 - NR.sv(zMid)) / 0.44, 0, 1);
      if (fogT > 0.01) {
        g.globalAlpha = fogT * fogT * 0.58;
        g.fillStyle = mixHex(pal.fog, pal.groundFar, 0.45);
        g.fillRect(xLo, Math.min(yA, yB) - 0.6, VW + XM * 2, Math.abs(yA - yB) + 1.2);
        g.globalAlpha = 1;
      }
      g.restore();
    }

    /* ---------- 4. 车道虚线（世界空间，随 scroll 后退） ---------- */
    const dashPeriod = 7.2, dashLen = 3.6;
    const base = scroll % dashPeriod;
    for (const lane of [-T.laneW * 0.5, T.laneW * 0.5]) {
      for (let k = 0; k < 40; k++) {
        const zA = k * dashPeriod - base - 4;
        const zB = zA + dashLen;
        if (zB < NR.view.zNear) continue;
        if (zA > NR.view.zFar + 40) break;
        const a = Math.max(zA, NR.view.zNear);
        const b = Math.max(zB, a + 0.001);
        const pa = NR.project(lane, a), pb = NR.project(lane, b);
        if (!pa || !pb || pa.y > VH + 8 || pb.y > VH + 8) continue;
        const wa = Math.max(0.7, 0.09 * pa.u);
        const wb = Math.max(0.7, 0.09 * pb.u);
        g.globalAlpha = clamp((NR.sv(a) - 0.06) * 3.2, 0, 1) * 0.9;
        g.fillStyle = pal.dash;
        g.beginPath();
        g.moveTo(pa.x - wa, pa.y); g.lineTo(pa.x + wa, pa.y);
        g.lineTo(pb.x + wb, pb.y); g.lineTo(pb.x - wb, pb.y);
        g.closePath(); g.fill();
      }
    }
    g.globalAlpha = 1;

    /* ---------- 5. 路缘石：主题色描边 + 内侧阴影 ---------- */
    const edgeW = Math.max(1.6, 0.14 * NR.unit(T.playerZ));
    for (const side of [-1, 1]) {
      const trace = () => {
        g.beginPath();
        let started = false;
        for (let i = 0; i <= ROAD_STEPS; i++) {
          if (xs[i] < 0.8) continue;
          const x = VW / 2 + side * xs[i];
          if (!started) { g.moveTo(x, ys[i]); started = true; } else g.lineTo(x, ys[i]);
        }
      };
      g.save();
      g.globalAlpha = 0.2;
      g.strokeStyle = '#000000';
      g.lineWidth = edgeW * 2.2;
      g.translate(0, edgeW * 1.1);
      trace(); g.stroke();
      g.restore();
      g.globalAlpha = 0.85;
      g.strokeStyle = pal.accent;
      g.lineWidth = edgeW;
      trace(); g.stroke();
    }
    g.globalAlpha = 1;
    void SHOULDER_FAR; void speedRatio;
  }

  /* --------------------------- 路边景物 -------------------------------- */
  function drawRoadside(g, VW, VH, pal, speedRatio) {
    const yH = NR.view.horizon;
    const period = 13;
    const base = scroll % period;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 22; k++) {
        const z = k * period - base;
        if (z < 1) continue;
        const pr = project(side * (T.roadHalf + 1.1), z);
        if (!pr) continue;
        const x = pr.x, y = pr.y;
        /* 灯杆高度用「离地平线的屏幕距离」来推，天然不会在近处爆炸 */
        const d = clamp(y - yH, 0, VH);
        const h = clamp(d * 1.5, 3, VH * 0.18);
        const w = clamp(h * 0.045, 1, 5);
        g.globalAlpha = clamp(NR.sv(z) * 0.9, 0, 1) * clamp(d / 30, 0, 1) * 0.4;
        if (g.globalAlpha < 0.02) continue;
        /* 灯杆 */
        g.fillStyle = shade(pal.silhouette2, -0.18);
        g.fillRect(x - w * 0.5, y - h, w, h);
        /* 灯臂（朝路内） */
        g.fillRect(x - side * h * 0.16, y - h, h * 0.16, w);
        /* 灯泡 */
        const lx = x - side * h * 0.16, ly = y - h + w;
        const lr = Math.max(1, h * 0.032);
        const lightGlow = g.createRadialGradient(lx, ly, 0, lx, ly, lr * 6);
        lightGlow.addColorStop(0, rgba(pal.lamp, 0.32));
        lightGlow.addColorStop(1, rgba(pal.lamp, 0));
        g.fillStyle = lightGlow;
        g.beginPath(); g.arc(lx, ly, lr * 6, 0, PI2); g.fill();
        g.fillStyle = pal.lamp;
        g.beginPath(); g.arc(lx, ly, lr, 0, PI2); g.fill();
        /* 夜间路面光斑 */
        if (pal.key === 'night' || pal.key === 'space') {
          const sxp = VW / 2 + side * (T.roadHalf - 1.2) * pr.u;
          if (Math.abs(sxp - VW / 2) < VW * 0.75) {
            const poolGrad = g.createRadialGradient(sxp, y, 0, sxp, y, h * 0.55);
            poolGrad.addColorStop(0, rgba(pal.lamp, 0.13));
            poolGrad.addColorStop(1, rgba(pal.lamp, 0));
            g.fillStyle = poolGrad;
            g.beginPath(); g.ellipse(sxp, y, h * 0.55, h * 0.16, 0, 0, PI2); g.fill();
          }
        }
        g.globalAlpha = 1;
      }
    }
    void speedRatio;
  }

  /* --------------------------- 角色精灵 -------------------------------- */
  const frames = { idle: [], walk: [], laugh: [] };
  let spritesReady = false;
  let spritesTotal = 0, spritesLoaded = 0, spritesFailed = 0;

  /** 推断 js/ 所在目录，好让素材路径与页面位置无关 */
  function scriptBase() {
    const scripts = document.getElementsByTagName('script');
    for (let i = scripts.length - 1; i >= 0; i--) {
      const src = scripts[i].getAttribute('src') || '';
      const m = src.match(/^(.*?)(?:js\/)?render\.js(?:\?.*)?$/);
      if (m) return m[1];
    }
    return '';
  }

  function loadSprites(base, onReady) {
    /* 把相对路径还原成相对「页面」的路径：浏览器对 file:// 的
     * img.src 是相对文档解析的，而 base 可能是相对 js/ 的。 */
    const abs = new URL(base, location.href).href;
    const defs = [['idle', 6], ['walk', 8], ['laugh', 8]];
    spritesTotal = spritesLoaded = spritesFailed = 0;
    const finishOne = ok => {
      if (ok) spritesLoaded++; else spritesFailed++;
      if (spritesLoaded + spritesFailed === spritesTotal) {
        /* 只要至少有一帧可用就算就绪；全失败才算失败 */
        spritesReady = spritesLoaded > 0;
        if (!spritesReady) console.warn('[奶龙跑酷] 角色素材加载失败，请检查 assets/ 路径：', abs);
        onReady && onReady(spritesReady);
      }
    };
    for (const [name, count] of defs) {
      for (let i = 0; i < count; i++) {
        spritesTotal++;
        const img = new Image();
        /* 用 complete + naturalWidth 判断，不能只靠 onload：
         * 加载失败时 onerror 也会触发，把「0×0 的图片」当成功。 */
        img.onload = () => finishOne(img.naturalWidth > 0);
        img.onerror = () => finishOne(false);
        img.src = `${abs}${name}/${String(i).padStart(2, '0')}.png`;
        frames[name].push(img);
      }
    }
  }
  const SEQ = { run: 'walk', jump: 'walk', roll: 'walk', fall: 'walk', laugh: 'laugh', idle: 'idle', over: 'laugh' };
  const SEQ_SPEED = { run: 8.6, jump: 3.4, roll: 15, fall: 3.4, laugh: 9, idle: 5, over: 9 };

  /* 锚点与尺寸：让脚正好落在 y = 0 */
  const ANCHOR = { idle: 0.988, walk: 0.988, laugh: 0.875 };
  const SCALE = { idle: 1.0, walk: 0.985, laugh: 0.79 };

  /** 角色地面影 */
  function drawShadow(g, x, z, radius, alpha) {
    const pr = project(x, z);
    if (!pr) return;
    const rx = radius * pr.u;
    if (rx < 0.6) return;
    const grad = g.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, rx);
    grad.addColorStop(0, `rgba(12,16,22,${alpha})`);
    grad.addColorStop(0.55, `rgba(12,16,22,${alpha * 0.5})`);
    grad.addColorStop(1, 'rgba(12,16,22,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(pr.x, pr.y, rx, rx * 0.32, 0, 0, PI2);
    g.fill();
  }

  /**
   * 画奶龙本体。
   * st: { x, z, y, height, seq, phase, lean, squashX, squashY, alpha, flash }
   */
  function drawPlayer(g, st) {
    const seqName = SEQ[st.seq] || 'walk';
    const list = frames[seqName];
    if (!list || !list.length || !list[0].complete) return;
    const spd = SEQ_SPEED[st.seq] || 8;
    const idx = ((Math.floor(st.phase * spd) % list.length) + list.length) % list.length;
    const img = list[idx];
    if (!img.complete || !img.naturalWidth) return;

    const u = unit(st.z);
    const heightPx = st.height * u * (SCALE[seqName] || 1);
    const w = heightPx * (img.naturalWidth / img.naturalHeight);
    const base = project(st.x, st.z);
    if (!base) return;
    const groundY = base.y - st.y * u;
    const anchor = ANCHOR[seqName] || 0.988;

    g.save();
    if (st.alpha != null && st.alpha < 1) g.globalAlpha = st.alpha;
    g.translate(base.x, groundY);
    if (st.lean) g.rotate(st.lean);
    const sx = (st.squashX || 1), sy = (st.squashY || 1);
    g.scale(sx, sy);
    const dw = w * 1, dh = heightPx;
    g.drawImage(img, -dw / 2, -dh * anchor, dw, dh);
    /* 受击白闪 */
    if (st.flash > 0.01) {
      g.globalAlpha = st.flash * 0.85;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(img, -dw / 2, -dh * anchor, dw, dh);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    g.restore();
  }

  /* --------------------------- 世界物体 -------------------------------- */
  function drawCoin(g, x, y, z, spin, pal, magnet) {
    const u = unit(z);
    const r = 0.34 * u;
    if (r < 0.5) return;
    const pr = project3(x, y, z);
    if (!pr) return;
    const squash = Math.abs(Math.cos(spin));
    g.save();
    g.translate(pr.x, pr.y);
    /* 光晕 */
    if (magnet) {
      const gl = g.createRadialGradient(0, 0, 0, 0, 0, r * 3);
      gl.addColorStop(0, rgba(pal.coin, 0.45));
      gl.addColorStop(1, rgba(pal.coin, 0));
      g.fillStyle = gl;
      g.beginPath(); g.arc(0, 0, r * 3, 0, PI2); g.fill();
    }
    g.scale(Math.max(0.14, squash), 1);
    const grad = g.createLinearGradient(-r, -r, r, r);
    grad.addColorStop(0, shade(pal.coin, 0.42));
    grad.addColorStop(0.45, pal.coin);
    grad.addColorStop(1, shade(pal.coin, -0.34));
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, r, 0, PI2); g.fill();
    g.lineWidth = Math.max(0.7, r * 0.16);
    g.strokeStyle = shade(pal.coin, -0.45);
    g.stroke();
    /* 内圈 + 星形 */
    g.lineWidth = Math.max(0.5, r * 0.1);
    g.strokeStyle = rgba('#ffffff', 0.55);
    g.beginPath(); g.arc(0, 0, r * 0.68, 0, PI2); g.stroke();
    g.fillStyle = rgba('#ffffff', 0.85);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.16 : r * 0.44;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
    g.restore();
  }

  /* 障碍物通用底座阴影 */
  function objShadow(g, x, z, halfW, height) {
    const pr = project(x, z);
    if (!pr) return;
    const u = unit(z);
    const rx = halfW * u * 1.5;
    if (rx < 1) return;
    const grad = g.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, rx);
    grad.addColorStop(0, 'rgba(10,14,20,0.42)');
    grad.addColorStop(1, 'rgba(10,14,20,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(pr.x, pr.y, rx, rx * 0.3, 0, 0, PI2);
    g.fill();
    void height;
  }

  /* --- 各类障碍物 --- */
  const OBST = {};

  OBST.barrier = (g, o, pal) => {
    const pr = project(o.x, o.z); if (!pr) return;
    const u = unit(o.z), w = 0.95 * u, h = 0.95 * u * T.rise;
    g.save(); g.translate(pr.x, pr.y);
    objShadow(g, o.x, o.z, 0.98, 0);
    /* 支腿 */
    g.fillStyle = '#333a42';
    g.fillRect(-w * 0.92, -h * 0.98, w * 0.13, h * 0.98);
    g.fillRect(w * 0.79, -h * 0.98, w * 0.13, h * 0.98);
    /* 横板 */
    const bh = h * 0.5, by = -h * 0.98;
    const grad = g.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, '#ff6a4d'); grad.addColorStop(1, '#d4371f');
    g.fillStyle = grad;
    g.fillRect(-w, by, w * 2, bh);
    g.strokeStyle = '#7d2017'; g.lineWidth = Math.max(0.6, u * 0.02);
    g.strokeRect(-w, by, w * 2, bh);
    /* 斜条纹 */
    g.save();
    g.beginPath(); g.rect(-w, by, w * 2, bh); g.clip();
    g.fillStyle = '#fff4e6';
    const sw = w * 0.34;
    for (let i = -3; i <= 3; i++) {
      g.save();
      g.translate(i * sw * 1.7, by + bh * 0.5);
      g.rotate(-0.6);
      g.fillRect(-sw * 0.34, -bh, sw * 0.68, bh * 2);
      g.restore();
    }
    g.restore();
    /* 顶部反光片 */
    g.fillStyle = pal.accent;
    g.fillRect(-w, by - h * 0.07, w * 2, h * 0.07);
    g.restore();
  };

  OBST.cone = (g, o, pal) => {
    const pr = project(o.x, o.z); if (!pr) return;
    const u = unit(o.z), w = 0.42 * u, h = 1.05 * u * T.rise;
    g.save(); g.translate(pr.x, pr.y);
    objShadow(g, o.x, o.z, 0.5, 0);
    /* 底座 */
    g.fillStyle = '#e8590c';
    g.beginPath();
    g.ellipse(0, 0, w * 1.5, w * 0.45, 0, 0, PI2);
    g.fill();
    /* 锥体 */
    const grad = g.createLinearGradient(-w, 0, w, 0);
    grad.addColorStop(0, '#c2410c'); grad.addColorStop(0.4, '#fb923c'); grad.addColorStop(1, '#ea580c');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(-w, 0); g.quadraticCurveTo(-w * 0.3, -h * 0.55, 0, -h);
    g.quadraticCurveTo(w * 0.3, -h * 0.55, w, 0);
    g.closePath(); g.fill();
    /* 反光条 */
    g.fillStyle = '#fff7e6';
    g.beginPath();
    g.moveTo(-w * 0.62, -h * 0.44); g.lineTo(w * 0.62, -h * 0.44);
    g.lineTo(w * 0.44, -h * 0.66); g.lineTo(-w * 0.44, -h * 0.66);
    g.closePath(); g.fill();
    g.fillStyle = pal.accent;
    g.beginPath();
    g.moveTo(-w * 0.5, -h * 0.7); g.lineTo(w * 0.5, -h * 0.7);
    g.lineTo(w * 0.38, -h * 0.84); g.lineTo(-w * 0.38, -h * 0.84);
    g.closePath(); g.fill();
    g.restore();
  };

  OBST.crate = (g, o, pal) => {
    const pr = project(o.x, o.z); if (!pr) return;
    const u = unit(o.z), w = 0.9 * u, h = 1.62 * u * T.rise;
    g.save(); g.translate(pr.x, pr.y);
    objShadow(g, o.x, o.z, 1.0, 0);
    const dep = w * 0.38;
    /* 顶面 */
    g.fillStyle = '#d89551';
    g.beginPath();
    g.moveTo(-w, -h); g.lineTo(-w + dep, -h - dep * 0.55);
    g.lineTo(w + dep, -h - dep * 0.55); g.lineTo(w, -h);
    g.closePath(); g.fill();
    /* 侧面 */
    g.fillStyle = '#8b522e';
    g.beginPath();
    g.moveTo(w, -h); g.lineTo(w + dep, -h - dep * 0.55);
    g.lineTo(w + dep, -dep * 0.55); g.lineTo(w, 0);
    g.closePath(); g.fill();
    /* 正面 */
    const grad = g.createLinearGradient(-w, 0, w, 0);
    grad.addColorStop(0, shade('#c07a42', -0.1));
    grad.addColorStop(0.5, '#c07a42');
    grad.addColorStop(1, shade('#c07a42', -0.22));
    g.fillStyle = grad;
    g.fillRect(-w, -h, w * 2, h);
    g.strokeStyle = '#653a1e'; g.lineWidth = Math.max(0.7, u * 0.03);
    g.strokeRect(-w, -h, w * 2, h);
    /* 木条 */
    g.lineWidth = Math.max(0.6, u * 0.022);
    g.strokeStyle = rgba('#653a1e', 0.75);
    g.beginPath();
    g.moveTo(-w, -h); g.lineTo(w, 0);
    g.moveTo(w, -h); g.lineTo(-w, 0);
    g.stroke();
    /* 标签 */
    g.fillStyle = pal.accent;
    g.fillRect(-w * 0.24, -h * 0.62, w * 0.48, h * 0.24);
    g.fillStyle = rgba('#000000', 0.35);
    g.fillRect(-w * 0.24, -h * 0.4, w * 0.48, h * 0.03);
    g.restore();
  };

  OBST.train = (g, o, pal) => {
    const pr = project(o.x, o.z); if (!pr) return;
    const u = unit(o.z), w = 1.16 * u, h = 3.4 * u * T.rise;
    g.save(); g.translate(pr.x, pr.y);
    objShadow(g, o.x, o.z, 1.3, 0);
    const dep = w * 0.3;
    /* 顶面 */
    g.fillStyle = '#b8352a';
    g.beginPath();
    g.moveTo(-w, -h); g.lineTo(-w + dep, -h - dep * 0.5);
    g.lineTo(w + dep, -h - dep * 0.5); g.lineTo(w, -h);
    g.closePath(); g.fill();
    /* 侧面 */
    g.fillStyle = '#8e2a21';
    g.beginPath();
    g.moveTo(w, -h); g.lineTo(w + dep, -h - dep * 0.5);
    g.lineTo(w + dep, -dep * 0.5); g.lineTo(w, 0);
    g.closePath(); g.fill();
    /* 正面 */
    const grad = g.createLinearGradient(-w, 0, w, 0);
    grad.addColorStop(0, '#a52f24'); grad.addColorStop(0.45, '#e0473a'); grad.addColorStop(1, '#b8352a');
    g.fillStyle = grad;
    g.fillRect(-w, -h, w * 2, h);
    /* 车头圆角 + 描边 */
    g.save();
    g.beginPath(); g.roundRect(-w, -h, w * 2, h, w * 0.16); g.clip();
    g.fillStyle = grad; g.fillRect(-w, -h, w * 2, h);
    /* 风挡 */
    const wy0 = -h * 0.9, wh = h * 0.36;
    g.fillStyle = '#1d3446';
    g.beginPath(); g.roundRect(-w * 0.78, wy0, w * 1.56, wh, w * 0.1); g.fill();
    const skyRef = g.createLinearGradient(0, wy0, 0, wy0 + wh);
    skyRef.addColorStop(0, rgba('#bfe9ff', 0.95));
    skyRef.addColorStop(1, rgba('#5f9fc4', 0.85));
    g.fillStyle = skyRef;
    g.beginPath(); g.roundRect(-w * 0.72, wy0 + wh * 0.1, w * 1.44, wh * 0.78, w * 0.08); g.fill();
    g.fillStyle = rgba('#ffffff', 0.35);
    g.beginPath();
    g.moveTo(-w * 0.7, wy0 + wh * 0.5); g.lineTo(-w * 0.2, wy0 + wh * 0.1);
    g.lineTo(w * 0.1, wy0 + wh * 0.1); g.lineTo(-w * 0.4, wy0 + wh * 0.9);
    g.closePath(); g.fill();
    /* 车灯 */
    const lampR = w * 0.19;
    for (const sx of [-1, 1]) {
      const lx = sx * w * 0.62, ly = -h * 0.3;
      const lg = g.createRadialGradient(lx, ly, 0, lx, ly, lampR * 2.6);
      lg.addColorStop(0, rgba('#fff6c0', 0.9));
      lg.addColorStop(1, rgba('#fff6c0', 0));
      g.fillStyle = lg;
      g.beginPath(); g.arc(lx, ly, lampR * 2.6, 0, PI2); g.fill();
      g.fillStyle = '#ffe66b';
      g.beginPath(); g.arc(lx, ly, lampR, 0, PI2); g.fill();
      g.strokeStyle = '#8a6a12'; g.lineWidth = Math.max(0.5, u * 0.013);
      g.stroke();
    }
    /* 保险杠 / 裙板 */
    g.fillStyle = '#2b3238';
    g.fillRect(-w, -h * 0.13, w * 2, h * 0.13);
    g.fillStyle = pal.accent;
    g.fillRect(-w, -h * 0.145, w * 2, h * 0.02);
    /* 警示条 */
    g.fillStyle = '#f4d03f';
    g.fillRect(-w * 0.98, -h * 0.56, w * 1.96, h * 0.045);
    g.restore();
    g.strokeStyle = '#6d1f18'; g.lineWidth = Math.max(0.8, u * 0.035);
    g.beginPath(); g.roundRect(-w, -h, w * 2, h, w * 0.16); g.stroke();
    g.restore();
  };

  OBST.overhead = (g, o, pal) => {
    const pr = project(o.x, o.z); if (!pr) return;
    const u = unit(o.z), w = 1.18 * u;
    const clearance = (o.clearance || 0.98) * u * T.rise;
    const barH = 0.62 * u * T.rise, total = 3.4 * u * T.rise;
    g.save(); g.translate(pr.x, pr.y);
    objShadow(g, o.x, o.z, 1.3, 0);
    /* 立柱 */
    g.fillStyle = '#39444d';
    g.fillRect(-w, -total, w * 0.16, total);
    g.fillRect(w - w * 0.16, -total, w * 0.16, total);
    /* 顶梁 */
    g.fillStyle = '#2b343c';
    g.fillRect(-w, -total, w * 2, barH * 0.34);
    /* 横杆（头顶） */
    const by = -clearance - barH;
    const grad = g.createLinearGradient(0, by, 0, by + barH);
    grad.addColorStop(0, '#ffc93c'); grad.addColorStop(1, '#e08c00');
    g.fillStyle = grad;
    g.fillRect(-w, by, w * 2, barH);
    g.strokeStyle = '#5a4210'; g.lineWidth = Math.max(0.7, u * 0.03);
    g.strokeRect(-w, by, w * 2, barH);
    /* 斜纹 */
    g.save();
    g.beginPath(); g.rect(-w, by, w * 2, barH); g.clip();
    g.fillStyle = rgba('#1f262c', 0.82);
    const sw = w * 0.26;
    for (let i = -3; i <= 3; i++) {
      g.save();
      g.translate(i * sw * 1.9, by + barH * 0.5);
      g.rotate(-0.6);
      g.fillRect(-sw * 0.3, -barH, sw * 0.6, barH * 2);
      g.restore();
    }
    g.restore();
    /* 提示文字 */
    if (u > 26) {
      g.save();
      g.translate(0, by + barH * 0.5);
      g.fillStyle = '#20262c';
      g.font = `900 ${barH * 0.52}px "Microsoft YaHei", system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('低头', 0, 0);
      g.restore();
    }
    /* 通过高度提示条 */
    g.fillStyle = rgba(pal.accent, 0.5);
    g.fillRect(-w, by + barH, w * 2, Math.max(1, u * 0.016));
    g.restore();
  };

  OBST.gap = (g, o, pal) => {
    const halfLen = 0.95;
    const zN = o.z - halfLen, zF = o.z + halfLen;
    const a = project(o.x, Math.max(zN, NR.view.zNear));
    const b = project(o.x, zF);
    if (!a || !b) return;
    const wa = 0.92 * a.u, wb = 0.92 * b.u;
    const xa = a.x, xb = b.x, ya = a.y, yb = b.y;
    void VW;
    /* 坑洞 */
    const grad = g.createLinearGradient(0, yb, 0, ya);
    grad.addColorStop(0, '#0a0d12');
    grad.addColorStop(0.5, '#141a22');
    grad.addColorStop(1, '#05070a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(xa - wa, ya); g.lineTo(xa + wa, ya);
    g.lineTo(xb + wb, yb); g.lineTo(xb - wb, yb);
    g.closePath(); g.fill();
    /* 近端边缘高亮 */
    const u = a.u;
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(1, u * 0.05);
    g.beginPath();
    g.moveTo(xa - wa, ya); g.lineTo(xa + wa, ya);
    g.stroke();
    /* 内部支撑钢筋 */
    g.strokeStyle = rgba('#5b6675', 0.7);
    g.lineWidth = Math.max(0.6, u * 0.02);
    for (let i = -2; i <= 2; i++) {
      const t = i / 2;
      g.beginPath();
      g.moveTo(xa + t * wa, ya - 1);
      g.lineTo(xb + t * wb * 0.8, yb + 2);
      g.stroke();
    }
    /* 警示围栏 */
    g.strokeStyle = pal.accent2 || '#ffb400';
    g.lineWidth = Math.max(1.2, u * 0.055);
    g.beginPath();
    g.moveTo(xa - wa * 1.25, ya - u * 0.1);
    g.lineTo(xa + wa * 1.25, ya - u * 0.1);
    g.stroke();
  };

  OBST.ramp = null; // 坡道单独绘制

  function drawRamp(g, o, pal) {
    const steps = 22;
    const len = o.length, hgt = o.height;
    const profile = (p, h) => {
      if (p < 0 || p > 1) return 0;
      if (p < 0.22) return smooth(p / 0.22) * h;
      if (p < 0.78) return h;
      return smooth((1 - p) / 0.22) * h;
    };
    for (let i = steps - 1; i >= 0; i--) {
      const p1 = i / steps, p2 = (i + 1) / steps;
      const z1 = o.z + p1 * len, z2 = o.z + p2 * len;
      if (z2 < -0.4 || z1 > 420) continue;
      const h1 = profile(p1, hgt), h2 = profile(p2, hgt);
      const pt1 = project3(o.x, h1, z1), pt2 = project3(o.x, h2, z2);
      if (!pt1 || !pt2) continue;
      const u1 = unit(z1), u2 = unit(z2);
      const w1 = 0.94 * u1, w2 = 0.94 * u2;
      const shadeAmt = i % 2 ? -0.06 : 0.04;
      /* 侧面（右） */
      g.fillStyle = shade('#c9902f', -0.3);
      g.beginPath();
      g.moveTo(pt1.x + w1, pt1.y);
      g.lineTo(pt2.x + w2, pt2.y);
      g.lineTo(pt2.x + w2, pt2.y + h2 * u2);
      g.lineTo(pt1.x + w1, pt1.y + h1 * u1);
      g.closePath(); g.fill();
      /* 顶面 */
      const grad = g.createLinearGradient(pt2.x, pt2.y, pt1.x, pt1.y);
      grad.addColorStop(0, shade(pal.accent, 0.12 + shadeAmt));
      grad.addColorStop(1, shade(pal.accent, -0.16 + shadeAmt));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(pt1.x - w1, pt1.y); g.lineTo(pt2.x - w2, pt2.y);
      g.lineTo(pt2.x + w2, pt2.y); g.lineTo(pt1.x + w1, pt1.y);
      g.closePath(); g.fill();
      /* 防滑纹 */
      if (i % 3 === 0) {
        g.strokeStyle = rgba('#fff3c4', 0.7);
        g.lineWidth = Math.max(0.6, u1 * 0.022);
        g.beginPath();
        g.moveTo(pt1.x - w1 * 0.85, pt1.y - 0.5);
        g.lineTo(pt1.x + w1 * 0.85, pt1.y - 0.5);
        g.stroke();
      }
    }
  }

  function drawObject(g, o, pal, VW, VH) {
    if (o.kind === 'coin') { drawCoin(g, o.x, o.y, o.z, o.spin, pal, o.magnet); return; }
    if (o.kind === 'gap') { OBST.gap(g, o, pal, VW, VH); return; }
    const fn = OBST[o.kind];
    if (fn) fn(g, o, pal);
  }

  /* --------------------------- 后处理 ---------------------------------- */
  function drawVignette(g, VW, VH, amount, tint) {
    if (amount <= 0.001) return;
    const grad = g.createRadialGradient(VW * 0.5, VH * 0.48, Math.min(VW, VH) * 0.28,
      VW * 0.5, VH * 0.5, Math.max(VW, VH) * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, rgba(tint || '#0a0f18', amount));
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);
  }

  function drawSpeedLines(g, VW, VH, amount, speed) {
    if (amount <= 0.01) return;
    const rng = makeRng(4242);
    const count = Math.floor(10 + amount * 26);
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const edge = 0.62 + rng() * 0.5;
      const cx = VW * 0.5, cy = NR.view.horizon;
      const r0 = Math.min(VW, VH) * edge;
      const len = (0.1 + rng() * 0.22) * Math.min(VW, VH) * (0.5 + amount);
      const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0 * 0.72;
      const x1 = cx + Math.cos(a) * (r0 + len), y1 = cy + Math.sin(a) * (r0 + len) * 0.72;
      g.globalAlpha = amount * (0.16 + rng() * 0.3);
      g.lineWidth = 1 + rng() * 2.4;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
    void speed;
  }

  function drawFog(g, VW, VH, pal, strength) {
    const yH = NR.view.horizon;
    const band = Math.max(24, VH * 0.1);
    const grad = g.createLinearGradient(0, yH - band, 0, yH + band * 1.6);
    grad.addColorStop(0, rgba(pal.fog, 0));
    grad.addColorStop(0.4, rgba(pal.haze, clamp(strength, 0, 1) * 0.9));
    grad.addColorStop(0.62, rgba(pal.haze, clamp(strength, 0, 1) * 0.7));
    grad.addColorStop(1, rgba(pal.fog, 0));
    g.fillStyle = grad;
    g.fillRect(0, yH - band, VW, band * 2.6);
  }

  /** 地平线上的远景轮廓（雾中剪影），让世界不显得空 */
  function drawFarLayer(g, VW, VH, pal) {
    const yH = NR.view.horizon;
    const key = `far|${pal.key}|${VW}|${Math.round(yH)}`;
    const s = NR.scratch(key, VW + 400, 90, 1);
    const c = s.ctx;
    const rng = makeRng(60607);
    c.globalAlpha = 0.5;
    c.fillStyle = pal.silhouette;
    c.beginPath();
    c.moveTo(0, 90);
    let x = 0;
    while (x < VW + 400) {
      const w = rng.range(30, 90), h = rng.range(10, 44);
      c.lineTo(x, 90 - h);
      c.lineTo(x + w, 90 - h * rng.range(0.6, 1.1));
      x += w + rng.range(6, 40);
    }
    c.lineTo(VW + 400, 90);
    c.closePath(); c.fill();
    const off = -((scroll * 0.03) % (VW + 400));
    g.drawImage(s.canvas, off, yH - 88);
    g.drawImage(s.canvas, off + VW + 400, yH - 88);
  }

  /* --------------------------- 对外接口 -------------------------------- */
  NR.render = {
    resetScroll,
    advance(dt, speed) { scroll += dt * speed; },
    get scroll() { return scroll; },
    get spritesReady() { return spritesReady; },
    get spriteStats() { return { total: spritesTotal, loaded: spritesLoaded, failed: spritesFailed }; },
    scriptBase,
    loadSprites,
    frames,
    drawSky, drawGround, drawRoad, drawRoadside, drawDecor: (g, VW, VH, pal) =>
      NR.biomes.drawDecor(g, VW, VH, pal, scroll, NR.view.horizon),
    drawFarLayer, drawFog, drawVignette, drawSpeedLines,
    drawShadow, drawPlayer, drawCoin, drawObject, drawRamp,
    ANCHOR, SCALE, SEQ
  };
})();

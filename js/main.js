/* ============================================================================
 * 奶龙跑酷 · 主控层
 * 状态机 / 输入 / 固定步长主循环 / HUD / 存档 / 调试面板
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const { clamp, lerp, smooth, project, worldToPx, rgba, makeRng } = NR;
  const T = NR.T;
  const W = NR.world;
  const R = NR.render;
  const P = NR.particles;
  const S = W.state;
  const A = NR.audio;

  const LS = {
    best: 'nailong-run-best',
    coins: 'nailong-run-coins',
    runs: 'nailong-run-runs',
    mute: 'nailong-run-mute',
    seen: 'nailong-run-seen-biomes'
  };

  /* ------------------------------ DOM ---------------------------------- */
  const $ = sel => document.querySelector(sel);
  const dom = {
    canvas: $('#game'),
    shell: $('#gameShell'),
    distance: $('#distance'),
    coins: $('#coins'),
    best: $('#best'),
    speed: $('#speed'),
    score: $('#score'),
    combo: $('#combo'),
    comboCount: $('#comboCount'),
    comboFill: $('#comboFill'),
    powerBar: $('#powerBar'),
    powerIcon: $('#powerIcon'),
    powerName: $('#powerName'),
    powerFill: $('#powerFill'),
    biomeChip: $('#biomeChip'),
    banner: $('#banner'),
    countdown: $('#countdown'),
    startPanel: $('#startPanel'),
    overPanel: $('#overPanel'),
    pausePanel: $('#pausePanel'),
    startBtn: $('#startBtn'),
    restartBtn: $('#restartBtn'),
    resumeBtn: $('#resumeBtn'),
    quitBtn: $('#quitBtn'),
    homeBtn: $('#homeBtn'),
    soundBtn: $('#soundBtn'),
    pauseBtn: $('#pauseBtn'),
    startBest: $('#startBest'),
    startCoins: $('#startCoins'),
    startRuns: $('#startRuns'),
    startBiomeName: $('#startBiomeName'),
    finalDistance: $('#finalDistance'),
    finalCoins: $('#finalCoins'),
    finalScore: $('#finalScore'),
    finalCombo: $('#finalCombo'),
    finalNear: $('#finalNear'),
    finalTime: $('#finalTime'),
    finalBiomes: $('#finalBiomes'),
    newRecord: $('#newRecord'),
    overTitle: $('#overTitle'),
    hintText: $('#hintText'),
    debug: $('#debugPanel')
  };
  const ctx = dom.canvas.getContext('2d', { alpha: false });

  /* ------------------------------ 存档 --------------------------------- */
  const store = {
    best: Number(localStorage.getItem(LS.best) || 0),
    coins: Number(localStorage.getItem(LS.coins) || 0),
    runs: Number(localStorage.getItem(LS.runs) || 0),
    mute: localStorage.getItem(LS.mute) === '1',
    seen: Number(localStorage.getItem(LS.seen) || 0)
  };
  const save = () => {
    localStorage.setItem(LS.best, store.best);
    localStorage.setItem(LS.coins, store.coins);
    localStorage.setItem(LS.runs, store.runs);
    localStorage.setItem(LS.mute, store.mute ? '1' : '0');
    localStorage.setItem(LS.seen, store.seen);
  };

  /* ------------------------------ 状态 --------------------------------- */
  const game = {
    state: 'menu',          // menu | countdown | playing | paused | over | dying
    time: 0,
    frame: 0,
    countdown: 0,
    dieTimer: 0,
    quality: 1,
    fps: 60, fpsAcc: 0, fpsFrames: 0,
    record: false,
    result: null,
    bannerTimer: 0,
    hintTimer: 0,
    hintShown: 0
  };
  const input = { left: false, right: false, jump: false, roll: false };
  let vw = 0, vh = 0, dpr = 1;

  /* ------------------------------ 尺寸 --------------------------------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = window.innerWidth; vh = window.innerHeight;
    dom.canvas.width = Math.round(vw * dpr);
    dom.canvas.height = Math.round(vh * dpr);
    dom.canvas.style.width = vw + 'px';
    dom.canvas.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    NR.setViewport(vw, vh);
  }
  window.addEventListener('resize', resize, { passive: true });

  /* ---------------------------- 界面切换 ------------------------------- */
  const show = (el, on) => { if (el) el.classList.toggle('hidden', !on); };

  function refreshStartPanel() {
    dom.best.textContent = NR.fmt(store.best);
    dom.startBest.textContent = NR.fmt(store.best) + ' m';
    dom.startCoins.textContent = NR.fmt(store.coins);
    dom.startRuns.textContent = NR.fmt(store.runs);
    const pal = NR.biomes.paletteAt(store.best);
    dom.startBiomeName.textContent = '从 ' + pal.emoji + ' ' + pal.name + ' 出发';
    dom.startPanel.style.setProperty('--accent', pal.accent);
    dom.startPanel.style.setProperty('--accent2', pal.accent2);
  }

  function banner(text, sub, seconds = 2.0) {
    dom.banner.innerHTML = `<b>${text}</b>${sub ? `<i>${sub}</i>` : ''}`;
    dom.banner.classList.remove('hidden');
    dom.banner.classList.remove('pop');
    void dom.banner.offsetWidth;
    dom.banner.classList.add('pop');
    game.bannerTimer = seconds;
  }

  function toastHint(text, seconds = 2.6) {
    dom.hintText.textContent = text;
    dom.hintText.classList.remove('hidden');
    game.hintTimer = seconds;
  }

  /* ---------------------------- 流程控制 ------------------------------- */
  function startRun() {
    A.unlock();
    A.play('click');
    W.reset(NR.SEED + (game.runIndex = (game.runIndex || 0) + 1) * 7919);
    R.resetScroll();
    game.state = 'countdown';
    game.countdown = 3.2;
    game.record = false;
    game.result = null;
    dom.countdown.classList.remove('hidden');
    dom.countdown.textContent = '3';
    show(dom.startPanel, false);
    show(dom.overPanel, false);
    show(dom.pausePanel, false);
    dom.combo.classList.add('hidden');
    dom.powerBar.classList.add('hidden');
    A.setIntensity(0.15);
    A.startMusic();
    /* 让第一波障碍不期而至前先给点缓冲：清空开局视野内的障碍 */
    S.objects = S.objects.filter(o => o.z < 120);
    if (NR.SHOT) { game.state = 'playing'; game.countdown = 0; dom.countdown.classList.add('hidden'); }
  }

  function toMenu() {
    game.state = 'menu';
    W.reset(NR.SEED);
    R.resetScroll();
    show(dom.startPanel, true);
    show(dom.overPanel, false);
    show(dom.pausePanel, false);
    dom.countdown.classList.add('hidden');
    dom.combo.classList.add('hidden');
    dom.powerBar.classList.add('hidden');
    A.stopMusic(0.4);
    refreshStartPanel();
  }

  function pauseRun() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    show(dom.pausePanel, true);
    A.setIntensity(0.08);
    A.play('click');
  }
  function resumeRun() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    show(dom.pausePanel, false);
    A.play('click');
  }

  function finishRun() {
    game.state = 'over';
    game.dieTimer = 0;
    const dist = Math.floor(S.distance);
    game.record = dist > store.best;
    if (game.record) store.best = dist;
    store.coins += S.coinCount;
    store.runs += 1;
    const biomes = Math.max(store.seen, S.biomesSeen);
    store.seen = Math.min(biomes, NR.biomes.list.length);
    save();
    refreshStartPanel();

    game.result = {
      distance: dist,
      coins: S.coinCount,
      score: Math.floor(S.score || 0),
      combo: S.maxCombo,
      near: S.nearMiss,
      time: S.elapsed,
      biomes: S.biomesSeen
    };

    dom.finalDistance.textContent = NR.fmt(dist);
    dom.finalCoins.textContent = NR.fmt(S.coinCount);
    dom.finalScore.textContent = NR.fmt(game.result.score);
    dom.finalCombo.textContent = '×' + NR.fmt(S.maxCombo);
    dom.finalNear.textContent = NR.fmt(S.nearMiss);
    dom.finalTime.textContent = S.elapsed.toFixed(1) + 's';
    dom.finalBiomes.textContent = NR.fmt(S.biomesSeen) + ' / ' + NR.biomes.list.length;
    dom.overTitle.textContent = game.record ? '新纪录！' : '本次成绩';
    show(dom.newRecord, game.record);
    if (game.record) {
      A.play('best');
      banner('新纪录', NR.fmt(dist) + ' 米', 2.6);
    }
    S.shake = 20;
    A.stopMusic(1.2);
    A.play('crash');
    A.play('laugh');
    setTimeout(() => show(dom.overPanel, true), 420);
  }

  /* ---------------------------- 键盘 / 触摸 ---------------------------- */
  const KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump',
    ArrowDown: 'roll', s: 'roll', S: 'roll'
  };
  window.addEventListener('keydown', e => {
    if (e.repeat) { if (KEYMAP[e.key]) e.preventDefault(); return; }
    const act = KEYMAP[e.key];
    if (act) {
      e.preventDefault();
      if (act === 'left') input.left = true;
      else if (act === 'right') input.right = true;
      else input[act] = true;
      A.unlock();
      return;
    }
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (game.state === 'playing') pauseRun();
      else if (game.state === 'paused') resumeRun();
      else if (game.state === 'menu') startRun();
    }
    if (e.key === 'Enter') {
      if (game.state === 'menu' || game.state === 'over') startRun();
      else if (game.state === 'paused') resumeRun();
    }
    if (e.key === 'm' || e.key === 'M') toggleSound();
    if (e.key === '`' || e.key === '~') dom.debug.classList.toggle('hidden');
  });
  window.addEventListener('keyup', e => {
    const act = KEYMAP[e.key];
    if (act === 'left' || act === 'right') input[act] = false;
  });

  /* 触摸：滑动 / 点击 */
  let touch = null;
  dom.canvas.addEventListener('pointerdown', e => {
    A.unlock();
    touch = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, fired: false };
  });
  dom.canvas.addEventListener('pointermove', e => {
    if (!touch || e.pointerId !== touch.id || touch.fired) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) input.left = true; else input.right = true;
      touch.fired = true;
      touch.dir = dx < 0 ? 'left' : 'right';
    } else if (Math.abs(dy) > 30) {
      if (dy < 0) input.jump = true; else input.roll = true;
      touch.fired = true;
    }
  });
  const endTouch = e => {
    if (!touch || (e && e.pointerId !== touch.id)) return;
    const dt = performance.now() - touch.t;
    const dx = e ? e.clientX - touch.x : 0, dy = e ? e.clientY - touch.y : 0;
    if (!touch.fired && dt < 260 && Math.hypot(dx, dy) < 22) {
      /* 轻点 = 跳跃（菜单里则开始游戏） */
      if (game.state === 'playing') input.jump = true;
      else if (game.state === 'menu') startRun();
      else if (game.state === 'over') startRun();
    }
    if (touch.dir) input[touch.dir] = false;
    touch = null;
  };
  dom.canvas.addEventListener('pointerup', endTouch);
  dom.canvas.addEventListener('pointercancel', endTouch);
  dom.canvas.addEventListener('pointerleave', e => { if (touch && !touch.fired) endTouch(e); });

  /* 手柄 / 触屏按钮：按住可持续变道 */
  document.querySelectorAll('[data-action]').forEach(btn => {
    const act = btn.dataset.action;
    const press = e => {
      e.preventDefault();
      A.unlock();
      if (act === 'left' || act === 'right') input[act] = true;
      else input[act] = true;
      btn.classList.add('active');
    };
    const release = () => {
      if (act === 'left' || act === 'right') input[act] = false;
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
  });

  function toggleSound() {
    store.mute = !store.mute;
    A.setMuted(store.mute);
    dom.soundBtn.textContent = store.mute ? '🔇' : '🔊';
    dom.soundBtn.setAttribute('aria-pressed', String(store.mute));
    if (!store.mute) A.play('click');
    save();
  }

  dom.startBtn.onclick = startRun;
  dom.restartBtn.onclick = () => { show(dom.overPanel, false); startRun(); };
  dom.resumeBtn.onclick = resumeRun;
  dom.quitBtn.onclick = () => { show(dom.pausePanel, false); toMenu(); };
  dom.homeBtn.onclick = () => { show(dom.overPanel, false); toMenu(); };
  dom.soundBtn.onclick = toggleSound;
  dom.pauseBtn.onclick = () => (game.state === 'playing' ? pauseRun() : resumeRun());
  window.addEventListener('blur', () => { if (game.state === 'playing') pauseRun(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') pauseRun();
  });

  /* ---------------------------- 更新逻辑 ------------------------------- */
  function step(dt) {
    game.time += dt;
    const pal = NR.biomes.paletteAt(S.distance);

    if (game.state === 'menu') {
      /* 菜单里让世界缓慢滚动，作为动态背景 */
      S.scrollSpeed = 9;
      R.advance(dt, 9);
      S.player.phase += dt * 3.4;
      S.player.lean = Math.sin(game.time * 0.6) * 0.02;
      P.update(dt, 9);
      return;
    }

    if (game.state === 'countdown') {
      const prev = Math.ceil(game.countdown);
      game.countdown -= dt;
      const now = Math.ceil(game.countdown);
      if (now !== prev) A.play('count', Math.max(0, now));
      dom.countdown.textContent = game.countdown > 0.25 ? String(Math.max(1, now)) : '跑！';
      R.advance(dt, 6);
      S.player.phase += dt * 4.2;
      P.update(dt, 6);
      if (game.countdown <= 0) {
        game.state = 'playing';
        dom.countdown.classList.add('hidden');
        banner(pal.emoji + ' ' + pal.name, '出发！', 1.8);
        toastHint('← → 变道　↑ 跳　↓ 翻滚', 3.2);
      }
      return;
    }

    if (game.state === 'over') {
      game.dieTimer += dt;
      S.scrollSpeed = Math.max(0, S.scrollSpeed - dt * 46);
      R.advance(dt, S.scrollSpeed);
      S.shake = Math.max(0, S.shake - dt * T.shakeDecay);
      S.hitFlash = Math.max(0, S.hitFlash - dt * 1.6);
      P.update(dt, S.scrollSpeed);
      /* 自动恢复慢速背景滚动 */
      if (game.dieTimer > 1.6) S.scrollSpeed = lerp(S.scrollSpeed, 6, dt);
      return;
    }

    if (game.state === 'paused') {
      P.update(dt * 0.0, 0);
      return;
    }

    /* ---- playing ---- */
    const speedBefore = S.speed;
    W.update(dt, input);
    R.advance(dt, S.speed);

    /* 速度感强度 */
    A.setIntensity(clamp((S.speed - T.speedStart) / (T.speedMax - T.speedStart), 0, 1));
    if (S.speed > speedBefore + 0.001 && game.frame % 8 === 0) {
      /* 里程碑提示 */
      const km = Math.floor(S.distance / 500);
      if (km > (game.lastKm || 0)) {
        game.lastKm = km;
        banner(`${km * 500} 米达成`, `当前速度 ${Math.round(S.speed * 2.6)} km/h`, 1.6);
        S.speedFlash = Math.max(S.speedFlash, 0.6);
      }
    }

    if (!S.player.alive) finishRun();
  }

  /* ---------------------------- 绘制 ----------------------------------- */
  function drawWorld(g) {
    const pal = S.palette || NR.biomes.paletteAt(S.distance);
    const speedRatio = clamp((S.speed - T.speedStart) / (T.speedMax - T.speedStart), 0, 1);
    const q = game.quality;

    R.drawSky(g, vw, vh, pal, game.time);
    R.drawDecor(g, vw, vh, pal);
    R.drawGround(g, vw, vh, pal);
    R.drawFarLayer(g, vw, vh, pal);
    R.drawRoad(g, vw, vh, pal, speedRatio);
    R.drawRoadside(g, vw, vh, pal, speedRatio);

    /* --- 把所有可绘制实体按深度排序 --- */
    const items = [];
    for (const r of S.ramps) items.push({ type: 'ramp', z: r.z + r.len * 0.5, o: r });
    for (const o of S.objects) {
      if (o.z < -14 || o.z > 700) continue;
      items.push({ type: 'obj', z: o.z, o });
    }
    items.push({ type: 'player', z: T.playerZ });
    items.sort((a, b) => b.z - a.z);

    for (const it of items) {
      if (it.type === 'ramp') { R.drawRamp(g, it.o, pal); continue; }
      if (it.type === 'obj') {
        R.drawObject(g, it.o, pal, vw, vh);
        continue;
      }
      drawPlayerLayer(g, pal);
    }

    if (q > 0.6) P.draw(g, 0);
    P.drawTexts(g);
  }

  function drawPlayerLayer(g, pal) {
    const p = S.player;
    const height = T.spriteH;
    /* 影子：空中时变小变淡 */
    const air = clamp(p.air / 1.3, 0, 1);
    R.drawShadow(g, p.x, T.playerZ, 0.62 * (1 - air * 0.35), 0.36 * (1 - air * 0.55));
    /* 速度越快，身后光带越亮 */
    const speedRatio = clamp((S.speed - T.speedStart) / (T.speedMax - T.speedStart), 0, 1);
    if (speedRatio > 0.35 && p.alive) {
      const u = NR.unit(T.playerZ);
      const pr = project(p.x, T.playerZ);
      if (pr) {
        const h = height * u;
        const grad = g.createLinearGradient(pr.x, pr.y - h, pr.x, pr.y);
        grad.addColorStop(0, rgba(pal.haze, 0));
        grad.addColorStop(1, rgba(pal.haze, 0.22 * (speedRatio - 0.35) / 0.65));
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(pr.x, pr.y - h * 0.45, h * 0.62, h * 0.6, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    /* 护盾泡 */
    if (S.shield) {
      const pr = project(p.x, T.playerZ);
      if (pr) {
        const u = NR.unit(T.playerZ);
        const r = height * u * 0.72;
        const pulse = 1 + Math.sin(game.time * 12) * 0.03;
        const grad = g.createRadialGradient(pr.x, pr.y - r * 0.62, r * 0.3, pr.x, pr.y - r * 0.62, r * pulse);
        const col = S.shield ? '#4fc3f7' : '#ffffff';
        grad.addColorStop(0, rgba(col, 0.05));
        grad.addColorStop(0.72, rgba(col, 0.28));
        grad.addColorStop(1, rgba(col, 0.02));
        g.fillStyle = grad;
        g.beginPath(); g.ellipse(pr.x, pr.y - r * 0.62, r * pulse, r * 1.05 * pulse, 0, 0, Math.PI * 2); g.fill();
        g.strokeStyle = rgba(col, 0.5);
        g.lineWidth = 2;
        g.stroke();
      }
    }
    R.drawPlayer(g, {
      x: p.x, z: T.playerZ, y: p.feet,
      height, seq: W.playerSeq(), phase: p.phase,
      lean: p.lean, squashX: p.squashX, squashY: p.squashY,
      alpha: 1,
      flash: game.state === 'over' ? clamp(game.dieTimer * 1.4, 0, 1) * 0.6 : 0
    });
  }

  function drawOverlay(g) {
    const pal = S.palette || NR.biomes.paletteAt(S.distance);
    const speedRatio = clamp((S.speed - T.speedStart) / (T.speedMax - T.speedStart), 0, 1);
    const boost = S.power && S.power.kind === 'boost' ? 1 : 0;

    /* 速度线 */
    const sl = clamp((S.speed - T.speedLineAt) / (T.speedMax - T.speedLineAt), 0, 1) + S.speedFlash * 0.5 + boost * 0.35;
    R.drawSpeedLines(g, vw, vh, clamp(sl, 0, 1.1), S.speed);

    /* 暗角 */
    R.drawVignette(g, vw, vh, 0.16 + speedRatio * 0.16 + boost * 0.1, pal.key === 'space' ? '#000814' : '#0a0f18');

    /* 受击红闪 */
    if (S.hitFlash > 0.01) {
      g.save();
      g.globalAlpha = S.hitFlash * 0.42;
      const grad = g.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.18, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
      grad.addColorStop(0, 'rgba(255,60,40,0)');
      grad.addColorStop(1, 'rgba(255,40,20,0.95)');
      g.fillStyle = grad;
      g.fillRect(0, 0, vw, vh);
      g.restore();
    }
    /* 冲刺绿闪 */
    if (S.speedFlash > 0.01) {
      g.save();
      g.globalAlpha = S.speedFlash * 0.22;
      g.fillStyle = pal.accent;
      g.fillRect(0, 0, vw, vh);
      g.restore();
    }
    /* 磁铁范围提示 */
    if (S.power && S.power.kind === 'magnet') {
      const p = S.player;
      g.save();
      g.globalAlpha = 0.14 + Math.sin(game.time * 7) * 0.05;
      g.strokeStyle = '#ff5c8a';
      g.lineWidth = 2;
      for (let i = 1; i <= 2; i++) {
        const z = i * 1.7;
        const pr = project(p.x, z);
        if (!pr) continue;
        const u = NR.unit(z);
        g.beginPath();
        g.ellipse(pr.x, pr.y, T.magnetRange * u * 0.42, T.magnetRange * u * 0.13, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }

  function drawDebug(g) {
    if (dom.debug.classList.contains('hidden')) return;
    g.save();
    g.strokeStyle = 'rgba(0,255,180,0.6)';
    g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(0, NR.view.horizon); g.lineTo(vw, NR.view.horizon); g.stroke();
    g.setLineDash([]);
    g.font = '12px ui-monospace, Consolas, monospace';
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(8, vh - 138, 236, 130);
    g.fillStyle = '#7cf03d';
    const lines = [
      `fps      ${game.fps.toFixed(0)}   q=${game.quality.toFixed(2)}`,
      `state    ${game.state}`,
      `speed    ${S.speed.toFixed(1)} (x${(S.speed / T.speedStart).toFixed(2)})`,
      `distance ${S.distance.toFixed(0)}m  biome#${S.biomeIndex}`,
      `objects  ${S.objects.length}  ramps ${S.ramps.length}`,
      `particle ${P.count()}`,
      `player   x=${S.player.x.toFixed(2)} feet=${S.player.feet.toFixed(2)}`,
      `unit@0   ${NR.unit(0).toFixed(1)}px   horizon ${NR.view.horizon.toFixed(0)}px`
    ];
    lines.forEach((l, i) => g.fillText(l, 16, vh - 118 + i * 14));
    /* 角色碰撞盒 */
    const hb = W.playerHitbox();
    const pr = project(hb.x, T.playerZ);
    if (pr) {
      const u = NR.unit(T.playerZ);
      g.strokeStyle = 'rgba(255,80,80,0.9)';
      g.lineWidth = 1.5;
      g.strokeRect(pr.x - hb.halfW * u, pr.y - hb.top * u, hb.halfW * 2 * u, hb.top * u);
    }
    g.restore();
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    /* 镜头抖动 */
    if (S.shake > 0.3) {
      const rngA = Math.sin(game.time * 61.7) * S.shake;
      const rngB = Math.cos(game.time * 53.3) * S.shake;
      ctx.translate(rngA * 0.6, rngB * 0.6);
      ctx.rotate(Math.sin(game.time * 43) * S.shake * 0.0006);
    }
    drawWorld(ctx);
    ctx.restore();
    drawOverlay(ctx);
    drawDebug(ctx);
  }

  /* ---------------------------- HUD 刷新 ------------------------------- */
  let hudAcc = 0;
  function updateHud(dt) {
    hudAcc += dt;
    if (hudAcc < 0.06) return;
    hudAcc = 0;
    const d = Math.floor(S.distance);
    dom.distance.textContent = d >= 1000 ? (d / 1000).toFixed(2) + 'k' : String(d);
    dom.coins.textContent = NR.fmt(S.coinCount);
    dom.speed.textContent = Math.round(S.speed * 2.6);
    dom.score.textContent = NR.fmt(S.score || 0);
    dom.best.textContent = NR.fmt(store.best);
    /* 连击条 */
    const active = S.combo > 1 && game.state === 'playing';
    dom.combo.classList.toggle('hidden', !active);
    if (active) {
      dom.comboCount.textContent = '×' + S.combo;
      dom.comboFill.style.width = clamp(S.comboTimer / T.comboTime, 0, 1) * 100 + '%';
    }
    /* 道具条 */
    const pw = S.power;
    dom.powerBar.classList.toggle('hidden', !pw);
    if (pw) {
      const def = W.POWERS[pw.kind];
      dom.powerIcon.textContent = def.icon;
      dom.powerName.textContent = def.name;
      dom.powerFill.style.width = clamp(pw.time / T.powerTime, 0, 1) * 100 + '%';
      dom.powerFill.style.background = def.color;
    }
    /* 主题徽章 */
    const pal = S.palette || NR.biomes.paletteAt(S.distance);
    dom.biomeChip.textContent = pal.emoji + ' ' + pal.name;
    dom.biomeChip.style.setProperty('--c', pal.accent);
    /* 横幅 / 提示计时 */
    if (game.bannerTimer > 0) {
      game.bannerTimer -= dt;
      if (game.bannerTimer <= 0) dom.banner.classList.add('hidden');
    }
    if (game.hintTimer > 0) {
      game.hintTimer -= dt;
      if (game.hintTimer <= 0) dom.hintText.classList.add('hidden');
    }
  }

  /* ---------------------------- 主循环 --------------------------------- */
  const FIXED = 1 / 60;
  let acc = 0, last = 0, started = false;
  function loop(t) {
    requestAnimationFrame(loop);
    if (!started) { started = true; last = t; }
    let dt = (t - last) / 1000;
    last = t;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.25);

    /* 帧率统计 + 自动降画质 */
    game.fpsAcc += dt; game.fpsFrames++;
    if (game.fpsAcc >= 0.5) {
      game.fps = game.fpsFrames / game.fpsAcc;
      game.fpsAcc = 0; game.fpsFrames = 0;
      if (game.fps < 44 && game.quality > 0.34) game.quality -= 0.22;
      else if (game.fps > 57 && game.quality < 1) game.quality = Math.min(1, game.quality + 0.11);
    }

    acc += dt;
    let steps = 0;
    while (acc >= FIXED && steps < 5) {
      acc -= FIXED;
      steps++;
      game.frame++;
      step(FIXED);
    }
    if (steps === 5) acc = 0;

    A.update();
    updateHud(dt);
    render();
  }

  /* ---------------------------- 初始化 --------------------------------- */
  function boot() {
    resize();
    A.setMuted(store.mute);
    dom.soundBtn.textContent = store.mute ? '🔇' : '🔊';
    refreshStartPanel();
    W.reset(NR.SEED);
    toMenu();
    R.loadSprites(R.scriptBase() + 'assets/', () => {
      dom.startPanel.classList.add('ready');
    });

    /* --- 调试 / 截图模式 --- */
    if (NR.START_DISTANCE > 0 || NR.AUTOSTART) {
      startRun();
      game.state = 'playing';
      dom.countdown.classList.add('hidden');
      /* 快进要等精灵图解码完再跑，否则截图里会缺角色。
       * 正常游戏没有这个问题（角色是边跑边加载的）。 */
      const fastForward = () => {
      const target = NR.START_DISTANCE;
      if (target > 0) {
        /* 快进到指定距离，用于检查各个主题的画面 */
        let guard = 0;
        while (S.distance < target && guard++ < 40000) {
          W.update(1 / 60, { left: false, right: false, jump: false, roll: false });
          S.player.alive = true;
          S.player.rolling = 0;
        }
        S.objects = [];
        S.ramps = [];
        S.player.alive = true;
        S.invuln = 1e9;          // 快进期间免伤（不进渲染，避免出现护盾光晕）
        S.renderInvuln = false;
        S.power = null;
        S.shield = false;
        W.spawnWave();
        for (let i = 0; i < 40; i++) W.update(1 / 60, { left: false, right: false, jump: false, roll: false });
      }
      if (NR.SHOT) { S.shake = 0; }
      };
      /* 精灵图没加载完就等一会儿再快进（最多等 1.5 秒） */
      let waited = 0;
      const tryStart = () => {
        if (R.spritesReady || waited > 1500) { fastForward(); return; }
        waited += 50;
        setTimeout(tryStart, 50);
      };
      tryStart();
    }
    if (NR.DEBUG) dom.debug.classList.remove('hidden');

    requestAnimationFrame(loop);
    /* 供自动化检查使用 */
    window.NR.game = game;
    window.NR.debugState = () => ({
      state: game.state, distance: S.distance, speed: S.speed,
      objects: S.objects.length, fps: game.fps, errors: NR.__errors || []
    });
  }

  /* 捕获运行期错误，方便自动化验证 */
  NR.__errors = [];
  window.addEventListener('error', e => NR.__errors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', e => NR.__errors.push('rejection: ' + String(e.reason)));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

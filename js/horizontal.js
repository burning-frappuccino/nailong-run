(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const shell = document.querySelector('#gameShell');
  const ctx = canvas.getContext('2d');
  const $ = id => document.querySelector(id);
  const ui = {
    distance: $('#distance'), coins: $('#coins'), score: $('#score'), best: $('#best'),
    startBest: $('#startBest'), startCoins: $('#startCoins'), biome: $('#biomeChip'),
    combo: $('#combo'), comboCount: $('#comboCount'), comboFill: $('#comboFill'), banner: $('#banner'),
    abilityStatus: $('#abilityStatus'), abilityLabel: $('#abilityLabel'),
    start: $('#startPanel'), pause: $('#pausePanel'), over: $('#overPanel'), overTitle: $('#overTitle'),
    finalDistance: $('#finalDistance'), finalCoins: $('#finalCoins'), finalScore: $('#finalScore'), finalCombo: $('#finalCombo'),
    startBtn: $('#startBtn'), restartBtn: $('#restartBtn'), homeBtn: $('#homeBtn'), resumeBtn: $('#resumeBtn'), quitBtn: $('#quitBtn'),
    pauseBtn: $('#pauseBtn'), soundBtn: $('#soundBtn'), supportBtn: $('#supportBtn'), supportModal: $('#supportModal'), supportClose: $('#supportClose'), supportLink: $('#supportLink')
  };

  const V = { width: 1280, height: 720, ground: 548, playerScreenX: 280 };
  const ASSET = 'assets/';
  const frames = { walk: [], laugh: [] };
  const playerImage = src => { const image = new Image(); image.src = ASSET + src; return image; };
  for (let i = 0; i < 8; i++) frames.walk.push(playerImage(`walk/${String(i).padStart(2, '0')}.png`));
  for (let i = 0; i < 8; i++) frames.laugh.push(playerImage(`laugh/${String(i).padStart(2, '0')}.png`));
  const laughAudio = new Audio(ASSET + 'laugh.mp3');
  laughAudio.preload = 'auto';
  laughAudio.volume = .9;
  const SUPPORT_URL = window.NAILONG_SUPPORT_URL || '';

  let dpr = 1, viewScale = 1, viewX = 0, viewY = 0;
  let cameraX = 0, last = performance.now(), muted = false, audioPrimed = false;
  let laughRunIndex = -1;
  let seed = Date.now() >>> 0;
  let rngState = seed;
  const input = { jump: false, roll: false, rollHeld: false, dash: false };
  const game = {
    state: 'menu', countdown: 0, time: 0, distance: 0, score: 0, coins: 0,
    combo: 0, comboTime: 0, maxCombo: 0, speed: 330, bannerTime: 0, biome: 0,
    shake: 0, runIndex: 0, best: Number(localStorage.getItem('nailong-side-best') || 0),
    totalCoins: Number(localStorage.getItem('nailong-side-coins') || 0)
  };
  // A delayed ended event from an old run must not cancel a new run's dash shake.
  laughAudio.addEventListener('ended', () => {
    if (game.state === 'over' && game.runIndex === laughRunIndex) game.shake = 0;
  });
  const player = {
    x: 280, feetY: V.ground, vy: 0, onGround: true, jumps: 0,
    roll: 0, dash: 0, boost: 0, dashCooldown: 0, invulnerable: 0, shield: false,
    runPhase: 0, lean: 0, alive: true, platform: null, support: null
  };
  let platforms = [], ramps = [], objects = [], particles = [], nextWorldX = 950, segmentIndex = 0;

  const BIOMES = [
    { key: 'city', name: '城市天台', emoji: '🏙', sky: ['#69c8ee', '#d9f4ff'], far: '#6f8797', near: '#31536a', ground: '#1d3545', top: '#71b56a', accent: '#ffc34d' },
    { key: 'sunset', name: '落日峡谷', emoji: '🌅', sky: ['#ef8d72', '#ffd39b'], far: '#9b5c54', near: '#65394a', ground: '#392b35', top: '#c58a4e', accent: '#ffe06a' },
    { key: 'snow', name: '雪原风口', emoji: '❄', sky: ['#8cc9ec', '#eaf8ff'], far: '#7f9eae', near: '#446779', ground: '#243a4c', top: '#dcecf0', accent: '#8be8ff' },
    { key: 'night', name: '霓虹夜城', emoji: '🌃', sky: ['#171b47', '#553d85'], far: '#33366a', near: '#181d45', ground: '#11182d', top: '#3bcaac', accent: '#ff72c6' }
  ];

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function rand() { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; }
  function range(min, max) { return min + (max - min) * rand(); }
  function pick(list) { return list[Math.floor(rand() * list.length)]; }
  function fmt(value) { return Math.round(value).toLocaleString('zh-CN'); }
  function show(element, visible) { if (element) element.classList.toggle('hidden', !visible); }
  function haptic(pattern) {
    if (document.hidden || typeof navigator.vibrate !== 'function') return false;
    try { return navigator.vibrate(pattern); } catch (_) { return false; }
  }
  function stopHaptic() { if (typeof navigator.vibrate !== 'function') return; try { navigator.vibrate(0); } catch (_) { /* 振动不可用时静默清理 */ } }

  function resize() {
    const width = Math.max(1, shell.clientWidth || document.documentElement.clientWidth || innerWidth);
    const height = Math.max(1, shell.clientHeight || document.documentElement.clientHeight || innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    viewScale = Math.min(width / V.width, height / V.height);
    viewX = (width - V.width * viewScale) / 2; viewY = (height - V.height * viewScale) / 2;
  }
  addEventListener('resize', resize, { passive: true }); resize();
  addEventListener('orientationchange', () => requestAnimationFrame(resize), { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize, { passive: true });

  function clearInput() { input.jump = false; input.roll = false; input.rollHeld = false; input.dash = false; }
  function resetRng() { rngState = (seed + game.runIndex * 7919) >>> 0; }

  function addPlatform(x, width, y) { platforms.push({ x, width, y }); }
  function addObject(kind, x, y, extra = {}) { objects.push(Object.assign({ kind, x, y, hit: false, passed: false, spin: rand() * Math.PI * 2 }, extra)); }
  function addCoinsLine(x1, x2, y, arc = 0) {
    const count = Math.max(3, Math.round((x2 - x1) / 48));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      addObject('coin', lerp(x1, x2, t), y - Math.sin(t * Math.PI) * arc, { radius: 15 });
    }
  }

  function generateSegment() {
    const previous = platforms[platforms.length - 1];
    const previousEnd = previous.x + previous.width;
    const difficulty = clamp(game.distance / 1700, 0, 1);
    const hasGap = segmentIndex > 1 && rand() < 0.16 + difficulty * 0.12;
    const gap = hasGap ? range(68, 124) : 0;
    const y = clamp(previous.y + (rand() < 0.55 ? range(-62, 62) : 0), 405, V.ground);
    const x = previousEnd + gap;
    const width = range(350, 540);
    addPlatform(x, width, y);
    if (!hasGap && Math.abs(y - previous.y) > 9) {
      const transition = clamp(118 + Math.abs(y - previous.y) * .35, 118, 176);
      ramps.push({ x1: previousEnd - transition, x2: x + 22, y1: previous.y, y2: y });
    }
    if (hasGap) addCoinsLine(previousEnd + 20, x - 18, Math.min(previous.y, y) - 110, 85);

    if (segmentIndex > 1) {
      const pattern = rand();
      const a = x + range(175, 215);
      const localCoins = (start, end, coinY, arc = 0) => {
        const left = x + 62, right = x + width - 46;
        const x1 = clamp(start, left, right), x2 = clamp(end, left, right);
        if (x2 - x1 >= 72) addCoinsLine(x1, x2, coinY, arc);
      };
      if (pattern < 0.18) {
        addObject('spike', a, y, { width: 58, height: 44 });
        localCoins(a + 74, a + 210, y - 88, 42);
      } else if (pattern < 0.36) {
        addObject('crate', a, y, { width: 74, height: 78 });
        localCoins(a + 95, a + 245, y - 122, 56);
      } else if (pattern < 0.53) {
        addObject('bar', a + 40, y, { width: 142, height: 27 });
        localCoins(a + 178, a + 285, y - 34, 18);
      } else if (pattern < 0.70) {
        addObject('power', a + 45, y - 126, { radius: 24, power: 'boost' });
        addObject('spike', a + 175, y, { width: 52, height: 40 });
        localCoins(a + 250, a + 360, y - 105, 45);
      } else if (pattern < 0.86) {
        addObject('saw', a + 55, y - 74, { radius: 32 });
        localCoins(a + 128, a + 275, y - 122, 50);
      } else {
        addObject('crate', a, y, { width: 70, height: 74 });
        localCoins(a + 76, a + 225, y - 116, 46);
      }
    } else {
      addCoinsLine(x + 100, x + 310, y - 62, 22);
    }
    const powerX = x + width - 90;
    const powerBlocked = objects.some(o => o.kind !== 'coin' && o.kind !== 'power' && Math.abs(o.x - powerX) < 112);
    if (segmentIndex > 3 && rand() < 0.12 && !powerBlocked) addObject('power', powerX, y - 105, { power: pick(['shield', 'boost']) });
    nextWorldX = x + width; segmentIndex++;
  }

  function ensureWorld() {
    while (nextWorldX < player.x + 3200) generateSegment();
  }

  function resetWorld() {
    resetRng(); platforms = []; ramps = []; objects = []; particles = [];
    nextWorldX = 950; segmentIndex = 0;
    addPlatform(-1100, 2050, V.ground);
    player.x = 280; player.feetY = V.ground; player.vy = 0; player.onGround = true; player.jumps = 0;
    player.roll = 0; player.dash = 0; player.boost = 0; player.dashCooldown = 0; player.invulnerable = 0; player.shield = false; player.runPhase = 0; player.lean = 0; player.alive = true; player.platform = platforms[0]; player.support = null;
    ensureWorld(); cameraX = player.x - V.playerScreenX;
  }

  function surfaceAt(x) {
    for (const ramp of ramps) if (x >= ramp.x1 && x <= ramp.x2) {
      return lerp(ramp.y1, ramp.y2, clamp((x - ramp.x1) / Math.max(1, ramp.x2 - ramp.x1), 0, 1));
    }
    for (let i = platforms.length - 1; i >= 0; i--) {
      const p = platforms[i]; if (x >= p.x && x <= p.x + p.width) return p.y;
    }
    return null;
  }

  function crateAt(x) {
    const halfWidth = 30;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.kind !== 'crate' || o.hit) continue;
      if (x + halfWidth > o.x - o.width / 2 && x - halfWidth < o.x + o.width / 2) return o;
    }
    return null;
  }

  function landOnCrate(previousFeet, nextFeet) {
    if (player.vy < 0) return false;
    const crate = crateAt(player.x);
    if (!crate) return false;
    const top = crate.y - crate.height;
    if (previousFeet <= top + 8 && nextFeet >= top) {
      player.feetY = top; player.vy = 0; player.onGround = true; player.jumps = 0; player.platform = top; player.support = crate;
      burst(player.x, top, '#d9d2ba', 4, 70);
      return true;
    }
    return false;
  }

  function isCrouching() { return player.roll > 0 || input.rollHeld; }

  function playerBox() {
    const rolling = isCrouching();
    const width = rolling ? 92 : 58, height = rolling ? 66 : 124;
    return { left: player.x - width / 2, right: player.x + width / 2, top: player.feetY - height, bottom: player.feetY, width, height };
  }
  function obstacleBox(o) {
    if (o.kind === 'orb' || o.kind === 'saw') return { left: o.x - o.radius, right: o.x + o.radius, top: o.y - o.radius, bottom: o.y + o.radius };
    if (o.kind === 'bar') return { left: o.x - o.width / 2, right: o.x + o.width / 2, top: o.y - 130, bottom: o.y - 103 };
    return { left: o.x - o.width / 2, right: o.x + o.width / 2, top: o.y - o.height, bottom: o.y };
  }
  function overlaps(a, b) { return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

  function burst(x, y, color, count = 10, spread = 150) {
    for (let i = 0; i < count; i++) particles.push({ x, y, vx: (rand() - .5) * spread, vy: -30 - rand() * spread, life: .55 + rand() * .45, color, size: 3 + rand() * 5 });
  }
  function beep(freq, duration = .08, type = 'sine', volume = .035) {
    if (muted) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!beep.ctx) beep.ctx = new AudioContext();
      if (beep.ctx.state === 'suspended') beep.ctx.resume();
      const osc = beep.ctx.createOscillator(), gain = beep.ctx.createGain();
      osc.type = type; osc.frequency.value = freq; gain.gain.setValueAtTime(volume, beep.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, beep.ctx.currentTime + duration);
      osc.connect(gain).connect(beep.ctx.destination); osc.start(); osc.stop(beep.ctx.currentTime + duration);
    } catch (_) { /* 音频不可用时静默运行 */ }
  }
  function unlockAudio() {
    beep(220, .025, 'sine', .012);
    if (audioPrimed) return;
    audioPrimed = true;
    laughAudio.muted = true;
    const pending = laughAudio.play();
    if (pending && pending.then) pending.then(() => {
      laughAudio.pause(); laughAudio.currentTime = 0; laughAudio.muted = muted;
    }, () => { audioPrimed = false; laughAudio.muted = muted; });
  }
  function setMuted(value) { muted = value; laughAudio.muted = muted; ui.soundBtn.textContent = muted ? '×' : '♪'; }
  function stopLaughAudio() {
    laughAudio.pause();
    laughAudio.currentTime = 0;
    laughRunIndex = -1;
  }

  function startRun() {
    unlockAudio(); stopLaughAudio(); stopHaptic(); haptic(18); laughAudio.muted = muted; clearInput(); game.runIndex++; game.state = 'playing'; game.countdown = 0;
    game.time = 0; game.distance = 0; game.score = 0; game.coins = 0; game.combo = 0; game.comboTime = 0; game.maxCombo = 0; game.speed = 330; game.biome = 0; game.bannerTime = 0; game.shake = 0;
    resetWorld(); show(ui.start, false); show(ui.pause, false); show(ui.over, false); ui.combo.classList.add('hidden'); showBanner('出发！');
  }
  function toMenu() { stopLaughAudio(); stopHaptic(); clearInput(); game.shake = 0; game.state = 'menu'; resetWorld(); show(ui.start, true); show(ui.pause, false); show(ui.over, false); ui.combo.classList.add('hidden'); refreshHud(); }
  function pauseRun() { if (game.state !== 'playing') return; stopHaptic(); clearInput(); game.state = 'paused'; show(ui.pause, true); beep(180, .08); }
  function resumeRun() { if (game.state !== 'paused') return; clearInput(); game.state = 'playing'; show(ui.pause, false); beep(320, .08); }
  function finishRun() {
    if (game.state === 'over') return;
    game.state = 'over'; clearInput(); game.shake = 6; haptic([70, 35, 120]);
    laughRunIndex = game.runIndex;
    const distance = Math.floor(game.distance), record = distance > game.best;
    if (record) game.best = distance;
    game.totalCoins += game.coins;
    localStorage.setItem('nailong-side-best', String(game.best)); localStorage.setItem('nailong-side-coins', String(game.totalCoins));
    ui.overTitle.textContent = record ? '新纪录！' : '本次成绩'; ui.finalDistance.textContent = fmt(distance); ui.finalCoins.textContent = fmt(game.coins); ui.finalScore.textContent = fmt(game.score); ui.finalCombo.textContent = '×' + game.maxCombo;
    show(ui.over, true); laughAudio.currentTime = 0; laughAudio.muted = muted; if (!muted) laughAudio.play().catch(() => {}); beep(record ? 760 : 180, .18, 'triangle', .05);
  }

  function doAction(action) {
    if (game.state !== 'playing') return;
    if (action === 'jump') input.jump = true;
    if (action === 'roll') input.roll = true;
    if (action === 'dash') input.dash = true;
  }

  function updatePlayer(dt) {
    const speed = game.speed * (player.dash > 0 ? 1.55 : player.boost > 0 ? 1.32 : 1);
    player.x += speed * dt;
    player.runPhase += dt * (speed / 38);
    player.dash = Math.max(0, player.dash - dt); player.boost = Math.max(0, player.boost - dt); player.dashCooldown = Math.max(0, player.dashCooldown - dt); player.invulnerable = Math.max(0, player.invulnerable - dt);
    if (input.dash) { input.dash = false; if (player.dashCooldown <= 0) { player.dash = .52; player.dashCooldown = 3.6; player.invulnerable = .58; game.shake = 5; haptic(32); beep(520, .12, 'sawtooth', .035); burst(player.x - 35, player.feetY - 35, '#89e7ff', 14, 210); } }
    if (input.jump) {
      input.jump = false;
      if (player.onGround) { player.vy = -770; player.onGround = false; player.jumps = 1; player.support = null; haptic(12); beep(530, .09, 'triangle'); burst(player.x - 22, player.feetY, '#d9d2ba', 7, 100); }
      else if (player.jumps === 1) { player.vy = -680; player.jumps = 2; haptic([9, 18, 9]); beep(690, .09, 'triangle'); burst(player.x, player.feetY + 10, '#ffe18a', 8, 120); }
    }
    const wantsRoll = input.rollHeld || input.roll;
    if (wantsRoll && player.roll <= 0) beep(260, .08, 'square', .022);
    if (input.rollHeld) player.roll = .12;
    if (input.roll) { player.roll = Math.max(player.roll, .62); input.roll = false; }
    const previousFeet = player.feetY;
    if (!player.onGround) { player.vy += 2100 * dt; player.feetY += player.vy * dt; }
    let landedOnCrate = false;
    if (!player.onGround) landedOnCrate = landOnCrate(previousFeet, player.feetY);
    const supportedCrate = player.support && !player.support.hit && player.support.kind === 'crate' && player.x + 30 > player.support.x - player.support.width / 2 && player.x - 30 < player.support.x + player.support.width / 2;
    if (player.onGround && supportedCrate) {
      player.feetY = player.support.y - player.support.height; player.vy = 0; player.platform = player.feetY;
    } else if (player.onGround && player.support && !supportedCrate) {
      player.support = null;
    }
    const surface = surfaceAt(player.x);
    if (!landedOnCrate && !supportedCrate && player.vy >= 0 && surface !== null && previousFeet <= surface + 5 && player.feetY >= surface) {
      player.feetY = surface; player.vy = 0; player.onGround = true; player.jumps = 0; player.platform = surface;
      burst(player.x, player.feetY, '#d9d2ba', 3, 65);
    } else if (!landedOnCrate && !supportedCrate && player.onGround && surface !== null) {
      player.feetY = surface; player.platform = surface;
    } else if (!landedOnCrate && !supportedCrate && surface === null && player.onGround) {
      player.onGround = false; player.vy = 90;
    }
    if (!input.rollHeld) player.roll = Math.max(0, player.roll - dt);
    if (player.feetY > V.height + 95) { player.alive = false; finishRun(); }
    player.lean = lerp(player.lean, player.dash > 0 ? -.11 : (player.vy < -10 ? -.06 : .035), Math.min(1, dt * 8));
  }

  function collectCoin(o) {
    o.hit = true; game.coins++; game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo); game.comboTime = 2.4; game.score += 10 + Math.floor(game.combo / 8) * 5; beep(730 + Math.min(game.combo, 12) * 24, .045, 'sine', .028); burst(o.x, o.y, BIOMES[game.biome].accent, 8, 100);
  }
  function crash(obstacle = null) {
    if (player.invulnerable > 0) return;
    if (player.shield) {
      player.shield = false; player.invulnerable = .72;
      if (obstacle) obstacle.hit = true;
      game.shake = 4; haptic([42, 28, 42]); showBanner('护盾抵挡一次伤害'); beep(420, .12, 'triangle', .04); burst(player.x, player.feetY - 50, '#ffd34d', 16, 220);
      return;
    }
    player.alive = false; game.shake = 0; beep(120, .26, 'sawtooth', .05); burst(player.x, player.feetY - 50, '#ff715b', 22, 260); finishRun();
  }
  function updateObjects(dt) {
    const box = playerBox();
    for (const o of objects) {
      o.x -= 0; o.spin += dt * (o.kind === 'coin' ? 7 : 3);
      if (o.kind === 'coin' || o.kind === 'power') {
        if (!o.hit && Math.abs(o.x - player.x) < 52 && Math.abs(o.y - (player.feetY - 55)) < 95) {
          if (o.kind === 'coin') collectCoin(o); else {
            o.hit = true; game.score += 50;
            if (o.power === 'boost') { player.boost = Math.max(player.boost, 5.2); haptic([16, 22, 16]); showBanner('蓝球：加速'); beep(760, .12, 'triangle'); burst(o.x, o.y, '#5be0f5', 14); }
            else { player.shield = true; haptic(28); showBanner('黄球：护盾'); beep(860, .12, 'triangle'); burst(o.x, o.y, '#ffd34d', 14); }
          }
        }
        continue;
      }
      if (!o.hit && Math.abs(o.x - player.x) < 105) {
        const obox = obstacleBox(o);
        if (overlaps(box, obox)) { if (player.dash > 0) { o.hit = true; game.score += 35; burst(o.x, o.y - 20, '#89e7ff', 14, 190); } else crash(o); }
      }
      if (!o.passed && o.x < player.x - 80) {
        o.passed = true;
        if (o.kind !== 'coin' && o.kind !== 'power' && !o.hit) { game.combo++; game.maxCombo = Math.max(game.maxCombo, game.combo); game.comboTime = 2.4; game.score += 20; }
      }
    }
    const cutoff = cameraX - 300;
    objects = objects.filter(o => !o.hit || o.kind === 'coin' && o.x > cutoff);
    objects = objects.filter(o => o.x > cutoff);
    particles.forEach(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 330 * dt; });
    particles = particles.filter(p => p.life > 0);
  }

  function update(dt) {
    game.shake = Math.max(0, game.shake - dt * 26);
    game.bannerTime = Math.max(0, game.bannerTime - dt);
    if (game.bannerTime <= 0) ui.banner.classList.add('hidden');
    if (game.state === 'menu') { player.runPhase += dt * 2.5; cameraX += dt * 12; return; }
    if (game.state === 'countdown') { game.countdown -= dt; player.runPhase += dt * 3; if (game.countdown <= 0) { game.state = 'playing'; beep(620, .12, 'triangle'); showBanner('出发！'); } return; }
    if (game.state === 'paused' || game.state === 'over') return;
    game.time += dt; game.speed = Math.min(620, 330 + game.distance * 0.055);
    const runMultiplier = player.dash > 0 ? 1.55 : player.boost > 0 ? 1.32 : 1;
    const runSpeed = game.speed * runMultiplier;
    game.distance += runSpeed * dt / 8; game.score += runSpeed * dt * .08;
    const nextBiome = Math.min(BIOMES.length - 1, Math.floor(game.distance / 520));
    if (nextBiome !== game.biome) { game.biome = nextBiome; showBanner(BIOMES[game.biome].emoji + ' ' + BIOMES[game.biome].name); }
    updatePlayer(dt); cameraX = player.x - V.playerScreenX; ensureWorld(); updateObjects(dt);
    if (game.comboTime > 0) { game.comboTime -= dt; if (game.comboTime <= 0) game.combo = 0; }
  }

  function showBanner(text) { ui.banner.textContent = text; ui.banner.classList.remove('hidden'); game.bannerTime = 1.5; }
  function refreshHud() {
    ui.distance.textContent = fmt(game.distance); ui.coins.textContent = fmt(game.coins); ui.score.textContent = fmt(game.score); ui.best.textContent = fmt(game.best); ui.startBest.textContent = fmt(game.best) + ' m'; ui.startCoins.textContent = fmt(game.totalCoins); ui.biome.textContent = BIOMES[game.biome].emoji + ' ' + BIOMES[game.biome].name;
    const active = game.combo > 1 && game.state === 'playing'; ui.combo.classList.toggle('hidden', !active); if (active) { ui.comboCount.textContent = '×' + game.combo; ui.comboFill.style.width = clamp(game.comboTime / 2.4, 0, 1) * 100 + '%'; }
    if (ui.abilityStatus) {
      const labels = [];
      if (player.shield) labels.push('盾 抵挡一次');
      if (player.boost > 0) labels.push('速 ' + Math.ceil(player.boost) + 's');
      ui.abilityStatus.classList.toggle('hidden', labels.length === 0);
      ui.abilityLabel.textContent = labels.join('  ·  ');
      ui.abilityStatus.classList.toggle('shield', player.shield);
      ui.abilityStatus.classList.toggle('boost', !player.shield && player.boost > 0);
    }
  }

  function screenX(worldX, parallax = 1) { return worldX - cameraX * parallax; }
  function poly(points, fill, stroke = null, width = 1) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } }
  function roundedRect(x, y, w, h, r, fill, stroke = null) { const rr = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr); ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr); ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); } }

  function drawGlow(x, y, radius, color) {
    ctx.globalAlpha = .12; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = .22; ctx.beginPath(); ctx.arc(x, y, radius * .72, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  function drawCloud(x, y, scale, color) {
    ctx.save(); ctx.globalAlpha = .22; ctx.fillStyle = color; ctx.beginPath();
    ctx.ellipse(x, y, 62 * scale, 17 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 42 * scale, y + 3 * scale, 30 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 35 * scale, y - 5 * scale, 38 * scale, 18 * scale, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }
  function drawBuilding(worldX, base, width, height, parallax, body, roof, index, lit = false) {
    const x = screenX(worldX, parallax);
    if (x + width < -30 || x > V.width + 30) return;
    ctx.fillStyle = body; ctx.fillRect(x, base - height, width, height);
    ctx.fillStyle = roof; ctx.fillRect(x - 4, base - height - 6, width + 8, 6);
    ctx.fillStyle = '#0b1b2a44'; ctx.fillRect(x + width - 9, base - height, 9, height);
    if (lit) {
      const cols = Math.max(2, Math.floor(width / 28)), rows = Math.max(2, Math.floor(height / 31));
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        if ((row * 5 + col * 3 + index) % 4 === 0) continue;
        ctx.fillStyle = (row + col + index) % 5 === 0 ? '#ffd36a99' : '#a7e9ff55';
        ctx.fillRect(x + 12 + col * 25, base - height + 15 + row * 28, 9, 7);
      }
    }
    if (index % 3 === 0) {
      ctx.strokeStyle = roof.length === 7 ? roof + 'aa' : roof; ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(x + width * .72, base - height); ctx.lineTo(x + width * .72, base - height - 24); ctx.stroke();
      ctx.fillStyle = roof; ctx.fillRect(x + width * .72 - 3, base - height - 26, 6, 3);
    }
  }
  function drawRidge(startWorld, base, parallax, color, profile, snow = null) {
    const step = 260, start = Math.floor(cameraX * parallax / step) - 2;
    for (let i = start; i < start + 9; i++) {
      const worldX = (Math.floor(startWorld / step) + i) * step, x = screenX(worldX, parallax);
      const points = [[x, base]]; profile.forEach((height, n) => points.push([x + n * step / (profile.length - 1), base - height])); points.push([x + step, base]); poly(points, color);
      if (snow) { const peak = profile.indexOf(Math.max(...profile)), px = x + peak * step / (profile.length - 1), py = base - profile[peak]; poly([[px - 25, py + 28], [px, py], [px + 26, py + 28], [px + 11, py + 19], [px, py + 26], [px - 12, py + 18]], snow); }
    }
  }

  function drawSky(pal) {
    const grad = ctx.createLinearGradient(0, 0, 0, V.ground + 40); grad.addColorStop(0, pal.sky[0]); grad.addColorStop(1, pal.sky[1]); ctx.fillStyle = grad; ctx.fillRect(0, 0, V.width, V.ground + 40);
    const celestialX = screenX(980, .04), celestialColor = pal.key === 'night' ? '#f3e9ff' : '#ffe996';
    drawGlow(celestialX, 125, 88, celestialColor); ctx.fillStyle = celestialColor; ctx.beginPath(); ctx.arc(celestialX, 125, 48, 0, Math.PI * 2); ctx.fill();
    const cloudStart = Math.floor(cameraX * .08 / 520) - 2;
    for (let i = cloudStart; i < cloudStart + 6; i++) drawCloud(screenX(i * 520 + 280, .08), 150 + (i & 1) * 68, i & 1 ? .68 : .9, '#ffffff');
    if (pal.key === 'city') {
      const farHeights = [82, 138, 104, 174, 116, 150, 92];
      const farStart = Math.floor(cameraX * .10 / 190) - 2;
      for (let i = farStart; i < farStart + 14; i++) drawBuilding(i * 190, 370, 118, farHeights[(i + 200) % farHeights.length], .10, pal.far, '#ffffff18', i, false);
      const nearHeights = [112, 188, 132, 214, 154, 176];
      const nearStart = Math.floor(cameraX * .24 / 230) - 2;
      for (let i = nearStart; i < nearStart + 13; i++) drawBuilding(i * 230 + 45, 472, 142, nearHeights[(i + 200) % nearHeights.length], .24, pal.near, '#ffffff22', i + 4, true);
    } else if (pal.key === 'sunset') {
      drawRidge(0, 430, .10, '#a65e59', [88, 162, 116, 205, 132, 174, 92]);
      drawRidge(130, 480, .23, '#65394a', [62, 120, 84, 156, 98, 130, 70]);
      ctx.strokeStyle = '#ffd69a88'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 438); ctx.quadraticCurveTo(340, 390, 680, 438); ctx.quadraticCurveTo(980, 475, 1280, 420); ctx.stroke();
    } else if (pal.key === 'snow') {
      drawRidge(0, 420, .10, '#7f9eae', [92, 190, 126, 236, 144, 205, 98], '#eaf8ff');
      drawRidge(170, 485, .24, '#446779', [54, 128, 82, 170, 102, 146, 62], '#dcecf0');
      const treeStart = Math.floor(cameraX * .30 / 210) - 2;
      for (let i = treeStart; i < treeStart + 12; i++) { const x = screenX(i * 210 + 90, .30); ctx.fillStyle = '#214355'; ctx.beginPath(); ctx.moveTo(x, 500); ctx.lineTo(x + 26, 444); ctx.lineTo(x + 51, 500); ctx.closePath(); ctx.fill(); }
    } else {
      const nightFarStart = Math.floor(cameraX * .10 / 195) - 2;
      for (let i = nightFarStart; i < nightFarStart + 14; i++) drawBuilding(i * 195 + 18, 386, 120, [100, 164, 128, 205, 142, 178][(i + 200) % 6], .10, pal.far, '#5f71bd55', i, true);
      const nightNearStart = Math.floor(cameraX * .25 / 238) - 2;
      for (let i = nightNearStart; i < nightNearStart + 13; i++) {
        const x = screenX(i * 238 + 32, .25), h = [138, 208, 162, 236, 177][(i + 200) % 5], base = 486;
        drawBuilding(i * 238 + 32, base, 148, h, .25, pal.near, '#7855aa', i + 7, true);
        ctx.fillStyle = i % 2 ? '#ff72c688' : '#62e7ff88'; ctx.fillRect(x + 18, base - h + 28, 110, 4);
      }
    }
    if (pal.key === 'night') {
      ctx.fillStyle = '#d9d2ff99';
      const starStart = Math.floor(cameraX * .05 / 92) - 2;
      for (let i = starStart; i < starStart + 20; i++) { const x = screenX(i * 92 + 30, .05), y = 62 + ((i * 37) % 160 + 160) % 160; ctx.fillRect(x, y, 2, 2); }
    }
  }

  function drawGround(pal) {
    const groundGrad = ctx.createLinearGradient(0, V.ground, 0, V.height); groundGrad.addColorStop(0, '#2b4a58'); groundGrad.addColorStop(.18, pal.ground); groundGrad.addColorStop(1, '#0c1725'); ctx.fillStyle = groundGrad; ctx.fillRect(0, V.ground, V.width, V.height - V.ground);
    for (const platform of platforms) {
      const x = screenX(platform.x), w = platform.width;
      if (x + w < -30 || x > V.width + 30) continue;
      poly([[x, platform.y], [x + w, platform.y], [x + w - 12, V.height], [x + 12, V.height]], pal.ground, '#0d1d2c', 2);
      ctx.fillStyle = pal.top; ctx.fillRect(x, platform.y, w, 13);
      ctx.fillStyle = '#ffffff2a'; ctx.fillRect(x, platform.y, w, 3);
      ctx.strokeStyle = '#ffffff20'; ctx.lineWidth = 2;
      const stripeStart = Math.floor(platform.x / 74) * 74;
      for (let stripe = stripeStart; stripe < platform.x + platform.width; stripe += 74) { const sx = screenX(stripe); ctx.beginPath(); ctx.moveTo(sx, platform.y + 28); ctx.lineTo(sx - 16, platform.y + 57); ctx.stroke(); }
      ctx.fillStyle = '#07152288'; ctx.fillRect(x, platform.y + 13, w, 7);
    }
    for (const ramp of ramps) {
      const x1 = screenX(ramp.x1), x2 = screenX(ramp.x2);
      if (x2 < -20 || x1 > V.width + 20) continue;
      poly([[x1, ramp.y1], [x2, ramp.y2], [x2, V.height], [x1, V.height]], '#233b4a');
      ctx.strokeStyle = pal.accent + '88'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x1, ramp.y1); ctx.lineTo(x2, ramp.y2); ctx.stroke();
      ctx.strokeStyle = '#ffffff18'; ctx.lineWidth = 2;
      for (let line = 1; line < 4; line++) { const t = line / 4, sx = lerp(x1, x2, t); ctx.beginPath(); ctx.moveTo(sx, lerp(ramp.y1, ramp.y2, t) + 22); ctx.lineTo(sx - 18, V.height); ctx.stroke(); }
    }
  }

  function drawCoin(o, pal) {
    const x = screenX(o.x), y = o.y, s = .72 + clamp((x / V.width) * .2, 0, .2), r = o.radius * s, squash = .25 + Math.abs(Math.cos(o.spin)) * .75;
    ctx.save(); ctx.translate(x, y); ctx.scale(squash, 1); ctx.shadowBlur = 18; ctx.shadowColor = pal.accent; ctx.fillStyle = pal.accent; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = '#fff1a0'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#fff9c5'; ctx.fillRect(-2, -r * .52, 4, r * 1.04); ctx.restore();
  }
  function drawObstacle(o, pal) {
    const x = screenX(o.x); if (x < -170 || x > V.width + 170) return;
    if (o.kind === 'spike') { ctx.fillStyle = '#ec5546'; ctx.strokeStyle = '#7d2421'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - o.width / 2, o.y); ctx.lineTo(x - o.width * .24, o.y - o.height); ctx.lineTo(x, o.y); ctx.lineTo(x + o.width * .24, o.y - o.height); ctx.lineTo(x + o.width / 2, o.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ffe181'; ctx.fillRect(x - o.width / 2, o.y - 8, o.width, 5); }
    if (o.kind === 'crate') { const w = o.width, h = o.height; poly([[x - w / 2, o.y - h], [x + w / 2, o.y - h - 9], [x + w / 2 + 12, o.y - h + 6], [x - w / 2 + 12, o.y - h + 15]], '#e0a060', '#5e351e', 3); ctx.fillStyle = '#b86b3c'; ctx.fillRect(x - w / 2, o.y - h, w, h); ctx.strokeStyle = '#65351e'; ctx.lineWidth = 5; ctx.strokeRect(x - w / 2, o.y - h, w, h); ctx.beginPath(); ctx.moveTo(x - w / 2 + 8, o.y - h + 9); ctx.lineTo(x + w / 2 - 8, o.y - 12); ctx.moveTo(x + w / 2 - 8, o.y - h + 9); ctx.lineTo(x - w / 2 + 8, o.y - 12); ctx.stroke(); }
    if (o.kind === 'bar') { ctx.fillStyle = '#344a58'; ctx.fillRect(x - o.width / 2, o.y - 130, 12, 130); ctx.fillRect(x + o.width / 2 - 12, o.y - 130, 12, 130); ctx.fillStyle = '#f0b337'; ctx.fillRect(x - o.width / 2, o.y - 130, o.width, o.height); ctx.strokeStyle = '#633f16'; ctx.lineWidth = 4; ctx.strokeRect(x - o.width / 2, o.y - 130, o.width, o.height); ctx.fillStyle = '#fff1bf'; for (let i = -2; i < 3; i++) { ctx.save(); ctx.translate(x + i * 31, o.y - 116); ctx.rotate(-.6); ctx.fillRect(-6, -18, 12, 36); ctx.restore(); } }
    if (o.kind === 'orb') { ctx.save(); ctx.translate(x, o.y); ctx.shadowBlur = 22; ctx.shadowColor = '#5be0f5'; ctx.fillStyle = '#5be0f5'; ctx.beginPath(); ctx.arc(0, 0, o.radius, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = '#e4ffff'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = '#206b9c'; ctx.beginPath(); ctx.arc(0, 0, o.radius * .56, 0, Math.PI * 1.4); ctx.stroke(); ctx.restore(); }
    if (o.kind === 'saw') { ctx.save(); ctx.translate(x, o.y); ctx.rotate(o.spin); ctx.fillStyle = '#d6dce8'; ctx.strokeStyle = '#4b5870'; ctx.lineWidth = 3; ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, r = i % 2 ? o.radius * .72 : o.radius; const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#f45c65'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    if (o.kind === 'power') { const boost = o.power === 'boost', color = boost ? '#5be0f5' : '#ffd34d'; ctx.save(); ctx.translate(x, o.y); ctx.shadowBlur = 20; ctx.shadowColor = color; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, o.radius || 22, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = '#fff9d2'; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = '#092037'; ctx.font = '900 17px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(boost ? '速' : '盾', 0, 1); ctx.restore(); }
  }

  function drawPlayer(pal) {
    const crouching = isCrouching();
    const x = screenX(player.x), h = crouching ? 94 : 158, w = h * (192 / 208) * (crouching ? 1.25 : 1), y = player.feetY - h;
    ctx.save(); ctx.globalAlpha = player.invulnerable > 0 && Math.floor(player.invulnerable * 18) % 2 ? .48 : 1;
    ctx.fillStyle = '#07121c66'; ctx.beginPath(); ctx.ellipse(x, player.feetY + 5, crouching ? 54 : 44, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (player.dash > 0 || player.boost > 0) { ctx.strokeStyle = player.dash > 0 ? '#8be8ff99' : '#5be0f599'; ctx.lineWidth = 5; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x - 50 - i * 18, y + 25 + i * 12); ctx.lineTo(x - 110 - i * 24, y + 25 + i * 12); ctx.stroke(); } }
    if (player.shield) { ctx.strokeStyle = '#ffd34d99'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y + h * .48, 78, 0, Math.PI * 2); ctx.stroke(); }
    const list = game.state === 'over' ? frames.laugh : frames.walk; let index = Math.floor(player.runPhase * 1.3) % 8; if (!player.onGround) index = player.vy < 0 ? 3 : 6;
    const image = list[index]; if (image && image.complete && image.naturalWidth) { ctx.translate(x, player.feetY); ctx.rotate(player.lean + (crouching ? .18 : 0)); ctx.scale(crouching ? 1.12 : 1, crouching ? .62 : 1); ctx.drawImage(image, -w / 2, -h * .988, w, h); }
    ctx.restore();
  }

  function drawParticles() { for (const p of particles) { ctx.globalAlpha = clamp(p.life * 1.8, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(screenX(p.x), p.y, p.size, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
  function draw(now) {
    const pal = BIOMES[game.biome];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1423'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, dpr * viewX, dpr * viewY);
    ctx.save(); if (game.shake > .2) ctx.translate((Math.random() - .5) * game.shake, (Math.random() - .5) * game.shake); drawSky(pal); drawGround(pal);
    const visible = objects.slice().sort((a, b) => a.x - b.x); for (const o of visible) { if (o.kind === 'coin') drawCoin(o, pal); else drawObstacle(o, pal); } drawParticles(); drawPlayer(pal); ctx.restore();
    refreshHud();
  }

  function loop(now) { const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now; update(dt); draw(now); requestAnimationFrame(loop); }

  function bindInput() {
    const keys = { ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump', Shift: 'dash', x: 'dash', X: 'dash' };
    const rollKeys = new Set(['ArrowDown', 's', 'S']);
    addEventListener('keydown', event => {
      if (event.key === 'Enter' && (game.state === 'menu' || game.state === 'over')) { event.preventDefault(); startRun(); return; }
      if (event.key === 'Escape' || event.key === 'p' || event.key === 'P') { event.preventDefault(); if (game.state === 'playing') pauseRun(); else if (game.state === 'paused') resumeRun(); return; }
      if (event.key === 'm' || event.key === 'M') { setMuted(!muted); return; }
      if (rollKeys.has(event.key) && game.state === 'playing') { event.preventDefault(); input.rollHeld = true; return; }
      const action = keys[event.key]; if (action && game.state === 'playing' && (!event.repeat || action === 'dash')) { event.preventDefault(); doAction(action); }
    });
    addEventListener('keyup', event => { if (rollKeys.has(event.key)) { input.rollHeld = false; } });
    let touch = null;
    const finishTouch = event => {
      if (!touch || touch.id !== event.pointerId) return;
      const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
      if (game.state === 'playing') {
        if (Math.abs(dy) > 28) doAction(dy < 0 ? 'jump' : 'roll');
        else if (Math.abs(dx) > 45) doAction('dash');
        else doAction('jump');
      } else if (game.state === 'menu' || game.state === 'over') startRun();
      touch = null;
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', event => {
      if (event.isPrimary === false) return;
      event.preventDefault();
      touch = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now() };
      canvas.setPointerCapture?.(event.pointerId);
      unlockAudio();
    }, { passive: false });
    canvas.addEventListener('pointerup', finishTouch, { passive: true });
    canvas.addEventListener('pointercancel', event => {
      if (touch && touch.id === event.pointerId && canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      input.rollHeld = false; touch = null;
    }, { passive: true });
    canvas.addEventListener('lostpointercapture', event => {
      if (touch && touch.id === event.pointerId) { input.rollHeld = false; touch = null; }
    }, { passive: true });
    document.querySelectorAll('[data-action]').forEach(button => {
      const action = button.dataset.action;
      const release = event => {
        if (action === 'roll') input.rollHeld = false;
        button.classList.remove('active');
        if (event?.pointerId != null && button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      };
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        if (action === 'roll') { input.rollHeld = true; haptic(10); }
        else doAction(action);
        button.classList.add('active');
      }, { passive: false });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, release, { passive: true }));
    });
    const openSupport = () => {
      show(ui.supportModal, true);
      if (SUPPORT_URL && ui.supportLink) { ui.supportLink.href = SUPPORT_URL; show(ui.supportLink, true); }
    };
    const closeSupport = () => show(ui.supportModal, false);
    ui.startBtn.onclick = startRun; ui.restartBtn.onclick = startRun; ui.homeBtn.onclick = toMenu; ui.resumeBtn.onclick = resumeRun; ui.quitBtn.onclick = toMenu; ui.pauseBtn.onclick = () => (game.state === 'playing' ? pauseRun() : resumeRun()); ui.soundBtn.onclick = () => setMuted(!muted);
    ui.supportBtn.onclick = openSupport; ui.supportClose.onclick = closeSupport;
    ui.supportModal.addEventListener('click', event => { if (event.target === ui.supportModal) closeSupport(); });
    addEventListener('keydown', event => { if (event.key === 'Escape' && !ui.supportModal.classList.contains('hidden')) closeSupport(); });
    addEventListener('blur', () => { stopHaptic(); if (game.state === 'playing') pauseRun(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { stopHaptic(); if (game.state === 'playing') pauseRun(); } });
  }

  resetWorld(); bindInput(); refreshHud(); requestAnimationFrame(loop);
})();

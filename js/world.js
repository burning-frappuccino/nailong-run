/* ============================================================================
 * 奶龙跑酷 · 世界 / 玩法层
 * 关卡生成器（可解性验证）+ 角色物理 + 碰撞 + 道具 + 连击 + 难度曲线
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const { clamp, lerp, smooth, unit, project, project3, worldToPx } = NR;
  const T = NR.T;
  const P = NR.particles;

  /* ------------------------------------------------------------------ *
   * 障碍物图鉴
   *   halfW / halfD：碰撞盒半宽半长
   *   top / bottom ：碰撞盒竖直范围（世界单位，地面为 0）
   *   pass          ：可通过方式，用于生成与提示
   * ------------------------------------------------------------------ */
  const KIND = {
    barrier: { halfW: 0.92, halfD: 0.30, top: 0.88, bottom: 0, pass: 'jump', name: '路障' },
    cone: { halfW: 0.48, halfD: 0.28, top: 0.95, bottom: 0, pass: 'jump', name: '路锥' },
    crate: { halfW: 0.86, halfD: 0.52, top: 1.62, bottom: 0, pass: 'jump', name: '货箱' },
    train: { halfW: 1.14, halfD: 0.95, top: 3.40, bottom: 0, pass: 'lane', name: '列车' },
    overhead: { halfW: 1.16, halfD: 0.34, top: 3.40, bottom: 0.98, pass: 'roll', name: '横杆' },
    gap: { halfW: 0.90, halfD: 0.92, top: 0.08, bottom: -3, pass: 'jump', name: '坑洞' },
    power: { halfW: 0.5, halfD: 0.5, top: 1.2, bottom: 0, pass: 'any', name: '道具' }
  };
  const Z_MARGIN = 0.9;
  const MIN_Z_GAP = (a, b) => KIND[a].halfD + KIND[b].halfD + Z_MARGIN;

  /** 障碍统一在这两个深度生成：可见距离之外，但进入视野时已经足够大 */
  const SPAWN_Z = 680;      // 常规生成深度（约 3 秒后进入可视区）
  

  const POWERS = {
    magnet: { name: '磁铁', icon: '🧲', color: '#ff5c8a', desc: '吸附全场金币' },
    shield: { name: '护盾', icon: '🛡', color: '#4fc3f7', desc: '抵挡一次撞击' },
    boost: { name: '冲刺', icon: '🚀', color: '#7cf03d', desc: '极速无敌' },
    double: { name: '二段跳', icon: '🪽', color: '#ffd166', desc: '空中再跳一次' }
  };

  /* --------------------------- 世界状态 -------------------------------- */
  const world = {
    objects: [],
    ramps: [],
    distance: 0,
    speed: T.speedStart,
    scrollSpeed: T.speedStart,
    elapsed: 0,
    combo: 0,
    comboTimer: 0,
    maxCombo: 0,
    coinCount: 0,
    nearMiss: 0,
    biomesSeen: 1,
    biomeIndex: 0,
    power: null,          // { kind, time }
    shield: false,
    invuln: 0,
    slowmo: 0,
    hitFlash: 0,
    speedFlash: 0,
    shake: 0,
    shakeSeed: 0,
    player: {
      lane: 1, x: 0, targetLane: 1,
      vy: 0, air: 0, feet: 0, ground: 0,
      rolling: 0, coyote: 0, buffer: 0,
      phase: 0, lean: 0, squashX: 1, squashY: 1,
      jumps: 0, alive: true
    },
    spawnZ: SPAWN_Z,
    waveTimer: 1.2,          // 距下一波的秒数
    firstWave: true,
    nearMissQueue: []
  };

  let rng = NR.makeRng(NR.SEED);
  const laneX = l => (l - 1) * T.laneW;

  function reset(seed) {
    rng = NR.makeRng(seed == null ? NR.SEED : seed);
    world.objects.length = 0;
    world.ramps.length = 0;
    world.distance = 0;
    world.speed = T.speedStart;
    world.scrollSpeed = T.speedStart;
    world.elapsed = 0;
    world.combo = 0; world.comboTimer = 0; world.maxCombo = 0;
    world.coinCount = 0; world.nearMiss = 0;
    world.biomesSeen = 1; world.biomeIndex = 0;
    world.power = null; world.shield = false;
    world.invuln = 0; world.slowmo = 0; world.hitFlash = 0;
    world.speedFlash = 0; world.shake = 0; world.shakeSeed = Math.random() * 1000;
    world.waveTimer = 1.2; world.lastWaveZ = SPAWN_Z;
    world.firstWave = true;
    world.ambAcc = 0; world.score = 0;
    world.nearMissQueue.length = 0;
    Object.assign(world.player, {
      lane: 1, x: 0, targetLane: 1, vy: 0, air: 0, feet: 0, ground: 0,
      rolling: 0, coyote: 0, buffer: 0, phase: 0, lean: 0,
      squashX: 1, squashY: 1, jumps: 0, alive: true
    });
    P.clear();
  }

  /* --------------------------- 难度曲线 -------------------------------- */
  const diff = () => clamp(world.distance / 1400, 0, 1);
  const speedAt = d => Math.min(T.speedMax, T.speedStart + d * T.accel * (1 + d / 900));

  /* --------------------------- 生成工具 -------------------------------- */
  const jitter = (v, amt) => v + (rng() - 0.5) * 2 * amt;

  function addObject(kind, lane, z, extra) {
    const o = Object.assign({
      kind, lane, z,
      x: laneX(lane),
      y: 0, spin: rng() * Math.PI * 2, hit: false, kindDef: KIND[kind]
    }, extra || {});
    world.objects.push(o);
    return o;
  }

  /** 在 [z0,z1] 之间加一串金币，形态可选 */
  function addCoinRun(lane, z0, z1, style, yBase) {
    const span = Math.abs(z1 - z0);
    if (span < 1) return;
    const space = clamp(3.4 - world.speed * 0.02, 2.0, 3.6);
    const n = Math.max(2, Math.round(span / space));
    const dir = Math.sign(z1 - z0) || 1;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = z0 + dir * span * t;
      let y = yBase ?? 0.95;
      if (style === 'arc') y = 0.75 + Math.sin(t * Math.PI) * 1.15;
      else if (style === 'wave') y = 0.9 + Math.sin(t * Math.PI * 2) * 0.55;
      else if (style === 'duck') y = 0.45 + Math.sin(t * Math.PI) * 0.25;
      addObject('coin', lane, z, { y: Math.max(0.42, y) });
    }
  }

  /* ------------------------------------------------------------------ *
   * 可解性验证器：把这一波障碍投影到「车道 × 深度行」的网格上，
   * 用 BFS 检查是否一定存在一条生路。不可解就重新生成。
   * ------------------------------------------------------------------ */
  function validateWave(entries) {
    const ROW = 1.1;
    const zs = entries.map(e => e.z);
    const zNear = Math.min(...zs) - 3.5, zFar = Math.max(...zs) + 3.5;
    const rows = Math.max(2, Math.ceil((zFar - zNear) / ROW));
    const zOf = r => zNear + (r + 0.5) * ROW;
    const free = [];
    for (let r = 0; r < rows; r++) {
      const z = zOf(r), row = [true, true, true];
      for (const e of entries) {
        const def = KIND[e.kind];
        if (!def || e.kind === 'coin' || e.kind === 'power') continue;
        if (Math.abs(e.z - z) > def.halfD + ROW * 0.5) continue;
        for (let l = 0; l < 3; l++) {
          if (Math.abs(laneX(l) - laneX(e.lane)) < def.halfW + T.playerHalfW - 0.03) row[l] = false;
        }
      }
      free.push(row);
    }
    let reach = [false, false, false];
    reach[0] = reach[1] = reach[2] = true;
    for (let r = 0; r < rows; r++) {
      const next = [false, false, false];
      for (let l = 0; l < 3; l++) {
        if (!free[r][l]) continue;
        if (reach[l] || (l > 0 && reach[l - 1]) || (l < 2 && reach[l + 1])) next[l] = true;
      }
      reach = next;
      if (!reach.some(Boolean)) return false;
    }
    /* 额外约束：一波之内不允许出现「左右横跳」的死循环，
     * 即同一行里最左和最右都被堵住时必须保证中间可走 */
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 波次生成
   * ------------------------------------------------------------------ */
  const startLaneOf = wave => {
    const first = wave.filter(e => e.kind !== 'coin' && e.kind !== 'power');
    if (!first.length) return 1;
    const sorted = first.slice().sort((a, b) => b.z - a.z);
    const reach = [];
    for (let l = 0; l < 3; l++) {
      let ok = true;
      for (const e of sorted) {
        const d = KIND[e.kind];
        if (Math.abs(laneX(l) - laneX(e.lane)) < d.halfW + T.playerHalfW - 0.03 && e.kind !== 'gap') ok = false;
      }
      if (ok) reach.push(l);
    }
    return reach.length ? rng.pick(reach) : 1;
  };

  function buildWave(z0) {
    const d = diff();
    const kinds = ['barrier', 'cone'];
    if (world.distance > T.overheadAfter) kinds.push('overhead');
    if (world.distance > T.trainAfter) kinds.push('train');
    const maxRows = world.distance > T.patternAfter ? (d > 0.5 ? 3 : 2) : 1;
    const rowCount = rng.chance(0.28 + d * 0.42) ? Math.min(maxRows, rng.int(2, maxRows)) : 1;
    const entries = [];
    const wantRamp = world.distance > T.rampAfter && rng.chance(0.09 + d * 0.05) && rowCount === 1;
    let z = z0;
    let prevKind = null, prevLane = 1;
    let rowGapTime = 0;

    if (wantRamp) {
      const lane = rng.int(0, 2);
      const len = 15, height = 1.02;
      world.ramps.push({ lane, z, len, height });
      addCoinRun(lane, z + len * 0.15, z + len * 0.85, 'line', null);
      /* 坡道上的金币需要跟着坡面抬高，交给 update 修正 */
      const onRamp = world.objects.filter(o => o.kind === 'coin' && o.lane === lane &&
        o.z >= z + len * 0.15 && o.z <= z + len * 0.85);
      for (const c of onRamp) {
        const p = (c.z - z) / len;
        c.y = rampProfile(p, height) + 0.85;
        c.onRamp = true;
      }
      /* 坡道两侧保证没有阻挡 */
      return { entries, z, lane, ramp: true };
    }

    for (let r = 0; r < rowCount; r++) {
      if (r > 0) {
        rowGapTime = rng.range(0.62, 0.95) * (1 - d * 0.28);
        z += world.speed * rowGapTime;
      }
      /* --- 选择本行要放的障碍 --- */
      const budget = rowCount === 1 ? 1 : (d > 0.65 && rng.chance(0.35) ? 3 : 2);
      const lanes = [0, 1, 2];
      if (rowCount > 1) rng.shuffle(lanes);
      let placed = 0;
      const forbiddenLanes = [];
      for (const lane of lanes) {
        if (placed >= budget) break;
        if (forbiddenLanes.includes(lane)) continue;
        let kind;
        const roll = rng();
        if (world.distance < T.overheadAfter) kind = rng.pick(['barrier', 'cone']);
        else if (roll < 0.30) kind = 'barrier';
        else if (roll < 0.50) kind = 'cone';
        else if (roll < 0.68) kind = 'overhead';
        else if (roll < 0.80 && world.distance > T.trainAfter) kind = 'train';
        else if (roll < 0.92) kind = 'crate';
        else kind = 'gap';
        /* 同一行不能出现两个都需要“跳/滚”的冲突组合放在相邻车道，
         * 也无法通过的列车相邻——先做基础过滤 */
        if (kind === 'train' && placed >= 1 && budget < 3) continue;
        if (prevKind === 'train' && kind === 'train' && r === 0) { /* 允许，交给验证器 */ }
        /* 相邻深度冲突检查 */
        let clash = false;
        for (const e of entries) {
          const need = MIN_Z_GAP(kind, e.kind);
          if (Math.abs(e.z - z) < need) clash = true;
        }
        if (clash) continue;
        entries.push({ kind, lane, z });
        if (kind === 'train') { forbiddenLanes.push(lane); }
        if (kind === 'gap') { forbiddenLanes.push(lane); }
        placed++;
        prevKind = kind; prevLane = lane;
      }
      /* 本行为空则补一个必须处理的障碍，避免空波 */
      if (placed === 0) {
        const lane = rng.int(0, 2);
        entries.push({ kind: rng.pick(['barrier', 'cone', 'crate']), lane, z });
        placed = 1;
      }
    }

    if (!validateWave(entries)) return null;
    return { entries, z: z + entries.length * 0.01, lane: startLaneOf(entries), rowGapTime };
  }

  function rampProfile(progress, height) {
    if (progress < 0 || progress > 1) return 0;
    if (progress < 0.22) return smooth(progress / 0.22) * height;
    if (progress < 0.78) return height;
    return smooth((1 - progress) / 0.78) * height;
  }

  function spawnWave() {
    const z0 = SPAWN_Z;
    world.firstWave = false;
    let wave = null, tries = 0;
    while (!wave && tries < 14) { wave = buildWave(z0); tries++; }
    if (!wave) {
      /* 极端情况下退化为单个障碍，保证一定能通过 */
      const lane = rng.int(0, 2);
      wave = { entries: [{ kind: rng.pick(['barrier', 'cone']), lane, z: z0 }], z: z0, lane, rowGapTime: 0 };
    }
    for (const e of wave.entries) addObject(e.kind, e.lane, e.z);

    /* 撒金币：优先铺在安全车道上 */
    const d = diff();
    if (rng.chance(0.72)) {
      const lane = rng.chance(0.55) ? wave.lane : rng.int(0, 2);
      const style = rng.chance(0.2) ? 'arc' : rng.chance(0.35) ? 'wave' : 'line';
      addCoinRun(lane, z0 + 4, z0 + 4 + world.speed * rng.range(1.0, 1.9), style, 0.95);
    }
    /* 道具 */
    if (world.distance > 180 && rng.chance(0.075)) {
      const keys = Object.keys(POWERS);
      const kind = rng.pick(keys);
      addObject('power', rng.int(0, 2), z0 + 22, { power: kind, y: 1.05 });
    }

    /* 下一波的等待时间：随难度收紧，多行波次多给一点反应时间 */
    const gapTime = T.gapBudget * (1 - d * 0.30) + (wave.rowGapTime || 0) + rng.range(0, 0.30);
    world.lastWaveZ = z0;
    world.waveTimer = gapTime;
  }

  /* --------------------------- 道具 ------------------------------------ */
  function grantPower(kind) {
    world.power = { kind, time: T.powerTime };
    if (kind === 'shield') world.shield = true;
    NR.audio.play('power');
    P.emit.powerRing(world.player.x, 1.0, 0.4, POWERS[kind].color);
    P.floatText(world.player.x, 0.2, `${POWERS[kind].icon} ${POWERS[kind].name}`, POWERS[kind].color, 1.25, 1.15);
    world.speedFlash = 0.5;
    if (kind === 'boost') { world.speedFlash = 1; world.shake = Math.max(world.shake, 5); }
  }

  function addCombo(amount) {
    world.combo += amount;
    world.comboTimer = T.comboTime;
    world.maxCombo = Math.max(world.maxCombo, world.combo);
  }

  /* --------------------------- 撞击 ------------------------------------ */
  function crash(o) {
    const p = world.player;
    if (world.invuln > 0) return;
    if (world.shield) {
      world.shield = false;
      world.power = null;
      world.invuln = 1.3;
      world.hitFlash = 0.6;
      world.shake = 14;
      NR.audio.play('crash');
      P.emit.crash(p.x, 0.9, 0.2, '#4fc3f7');
      P.floatText(p.x, 0.4, '护盾抵挡！', '#4fc3f7', 1.2, 1.0);
      if (o) o.hit = true;
      return;
    }
    world.player.alive = false;
    world.hitFlash = 1;
    world.shake = 22;
    NR.audio.play('crash');
    P.emit.crash(p.x, 0.9, 0.2, '#ff5a3c');
  }

  /* --------------------------- 更新 ------------------------------------ */
  function updatePlayer(dt, input) {
    const p = world.player;

    /* --- 变道 --- */
    if (input.left) { input.left = false; p.targetLane = Math.max(0, p.targetLane - 1); }
    if (input.right) { input.right = false; p.targetLane = Math.min(2, p.targetLane + 1); }

    const tx = laneX(p.targetLane);
    const dx = tx - p.x;
    /* 空中仍可小幅变道，但速度略降，避免“空中乱窜” */
    const airFactor = p.air > 0.02 ? 0.86 : 1;
    const maxV = 7.6 * airFactor;
    const desired = clamp(dx * 13, -maxV, maxV);
    p.vx = NR.damp(p.vx || 0, desired, 0.055, dt);
    p.x += p.vx * dt;
    if (Math.abs(dx) < 0.012 && Math.abs(p.vx) < 0.35) { p.x = tx; p.vx = 0; }
    p.lane = clamp((p.x / T.laneW) + 1, 0, 2);
    p.lean = NR.damp(p.lean, clamp(p.vx * 0.05, -0.2, 0.2), 0.09, dt);

    /* --- 跳跃 --- */
    if (input.jump) { input.jump = false; p.buffer = T.jumpBuffer; }
    if (p.buffer > 0) p.buffer -= dt;
    const grounded = p.air <= 0.02;

    if (p.buffer > 0 && p.rolling <= 0) {
      if (grounded || p.coyote > 0) {
        p.vy = T.jumpV; p.air = 0.001; p.buffer = 0; p.coyote = 0;
        p.jumps = 1; p.feet = Math.max(p.feet, p.ground);
        p.squashX = 0.88; p.squashY = 1.14;
        NR.audio.play('jump');
        P.emit.dust(p.x, p.feet, 0.1, 6);
      } else if (world.power && world.power.kind === 'double' && p.jumps < 2) {
        p.vy = T.jumpV * 0.88; p.jumps = 2; p.buffer = 0;
        p.squashX = 0.9; p.squashY = 1.12;
        NR.audio.play('jump');
        P.emit.powerRing(p.x, p.feet + 0.4, 0.15, POWERS.double.color);
      }
    }

    /* --- 翻滚 --- */
    if (input.roll) {
      input.roll = false;
      if (p.rolling <= 0) {
        if (grounded || p.air < 0.35) {
          p.rolling = T.rollTime;
          NR.audio.play('roll');
          P.emit.dust(p.x, p.feet, 0.1, 7);
        }
      }
    }
    if (p.rolling > 0) {
      p.rolling -= dt;
      if (p.rolling <= 0) { p.rolling = 0; P.emit.dust(p.x, p.feet, 0.1, 5); }
    }

    /* --- 竖直运动 --- */
    if (p.air > 0 || p.vy > 0) {
      p.vy -= (p.vy > 0 ? T.gravity : T.gravityFall) * dt;
      p.air += p.vy * dt;
      if (p.air <= 0) {
        p.air = 0; p.vy = 0; p.jumps = 0;
        p.squashX = 1.16; p.squashY = 0.84;
        NR.audio.play('land');
        P.emit.dust(p.x, p.feet, 0.1, 8);
        world.shake = Math.max(world.shake, 2.2);
      }
    }

    /* --- 地形高度（坡道） --- */
    let groundTarget = 0;
    for (const ramp of world.ramps) {
      if (Math.abs(laneX(ramp.lane) - p.x) > T.laneW * 0.72) continue;
      const profile = rampProfile((ramp.z - T.playerZ) / ramp.length, ramp.height);
      groundTarget = Math.max(groundTarget, profile);
    }
    const rate = groundTarget > p.ground ? 1 / 0.06 : 1 / 0.1;
    p.ground = NR.damp(p.ground, groundTarget, rate, dt);
    if (groundTarget === 0 && p.ground < 0.004) p.ground = 0;
    p.feet = p.ground + p.air;

    /* 离地判定：真的在地面上才算站立 */
    const onGround = p.air <= 0.02;
    p.coyote = onGround ? T.coyote : Math.max(0, p.coyote - dt);

    /* --- 挤压恢复 --- */
    p.squashX = NR.damp(p.squashX, 1, 0.045, dt);
    p.squashY = NR.damp(p.squashY, 1, 0.045, dt);

    /* --- 动画相位 --- */
    const speedRatio = world.speed / T.speedMax;
    if (p.rolling > 0) p.phase += dt * 9;
    else if (p.air > 0.02) p.phase += dt * 2.2;
    else p.phase += dt * (5.2 + speedRatio * 5.4);

    /* --- 落地/落地时的摩擦粒子 --- */
    if (onGround && p.rolling <= 0) {
      p.stepAcc = (p.stepAcc || 0) + dt * (4 + speedRatio * 7);
      if (p.stepAcc >= 1) {
        p.stepAcc -= 1;
        P.emit.dust(p.x, p.feet, 0.12, 2);
        NR.audio.play('step', Math.random() < 0.5);
      }
    }
    void project;
  }

  /* --------------------------- 碰撞 ------------------------------------ */
  const overlapsZ = (o, r) => Math.abs(o.z - T.playerZ) < (o.kindDef.halfD + r);
  const overlapsX = o => Math.abs(o.x - world.player.x) < (o.kindDef.halfW + T.playerHalfW);

  function collide() {
    const p = world.player;
    const isRolling = p.rolling > 0;
    const feet = p.feet;
    const height = (isRolling ? T.rollH : T.standH) * (p.squashY < 0.96 ? 0.92 : 1);
    const bodyTop = feet + height;

    for (const o of world.objects) {
      if (o.hit) continue;
      if (Math.abs(o.z - T.playerZ) > 6) continue;

      /* --- 金币 --- */
      if (o.kind === 'coin') {
        if (Math.abs(o.z - T.playerZ) > 0.55) continue;
        if (Math.abs(o.x - p.x) > T.playerHalfW + 0.4) continue;
        if (Math.abs(o.y - (feet + 0.55)) > 0.95) continue;
        collectCoin(o);
        continue;
      }
      /* --- 道具 --- */
      if (o.kind === 'power') {
        if (Math.abs(o.z - T.playerZ) > 0.85) continue;
        if (Math.abs(o.x - p.x) > T.playerHalfW + 0.62) continue;
        if (Math.abs(o.y - (feet + 0.55)) > 1.3) continue;
        o.hit = true;
        grantPower(o.power);
        continue;
      }

      /* --- 障碍 --- */
      const def = o.kindDef;
      if (!overlapsZ(o, T.playerHalfD)) continue;
      if (!overlapsX(o)) continue;
      const blocked = feet < def.top - 0.04 && bodyTop > def.bottom + 0.04;
      if (blocked) { crash(o); continue; }
      /* 没撞上：判定擦身而过 */
      if (!o.nearMiss && Math.abs(o.x - p.x) < def.halfW + T.playerHalfW + T.nearMissDist) {
        o.nearMiss = true;
        world.nearMissQueue.push(o);
      }
    }
  }

  function collectCoin(o) {
    o.hit = true;
    world.coinCount++;
    const value = 1 + Math.floor(world.combo / 8);
    addCombo(1);
    NR.audio.play('coin', world.combo);
    const pal = world.palette || {};
    P.emit.coinBurst(o.x, o.y, o.z, pal.coin || '#ffc400');
    if (world.combo > 1 && world.combo % 5 === 0) {
      P.floatText(o.x, o.y, `连击 ×${world.combo}`, '#ffd166', 1.1 + Math.min(world.combo / 40, 0.9), 1.1);
    } else if (value > 1) {
      P.floatText(o.x, o.y, `+${value}`, '#fff6c0', 0.9, 0.8);
    }
    /* 连击奖励分数 */
    world.score = (world.score || 0) + 10 * value;
    void value;
  }

  /* --------------------------- 主更新 ---------------------------------- */
  function update(dt, input) {
    world.elapsed += dt;
    const p = world.player;

    /* 速度曲线：距离越远越快，冲刺道具再叠一层 */
    const boost = world.power && world.power.kind === 'boost' ? 1.34 : 1;
    const target = speedAt(world.distance) * boost;
    world.speed = NR.approach(world.speed, target, 1.1, dt);
    world.scrollSpeed = world.speed;

    if (p.alive) {
      world.distance += world.speed * dt;
      world.score = (world.score || 0) + world.speed * dt * 0.6;
    }

    updatePlayer(dt, input);

    /* 世界整体向后移动 */
    const dz = world.speed * dt;
    for (const o of world.objects) {
      o.z -= dz;
      o.spin += dt * 6.5;
    }
    for (const r of world.ramps) r.z -= dz;

    /* 生成新波次：按「时间」调度。
     * 之前用距离调度，而距离间隔 = speed × 间隔秒数，
     * 速度涨到 3 倍后间隔也涨到 3 倍，屏幕上就空了。
     * 改成时间调度后，无论多快，障碍出现的时间间隔都恒定。 */
    world.waveTimer -= dt;
    if (world.waveTimer <= 0) spawnWave();

    /* 连击计时 */
    if (world.comboTimer > 0) {
      world.comboTimer -= dt;
      if (world.comboTimer <= 0) { world.combo = 0; world.comboTimer = 0; }
    }

    /* 磁铁吸附 */
    if (world.power && world.power.kind === 'magnet') {
      const range = T.magnetRange;
      for (const o of world.objects) {
        if (o.kind !== 'coin' || o.hit) continue;
        const dzz = o.z - T.playerZ;
        if (dzz < -1.4 || dzz > range * 3.4) continue;
        const dxx = o.x - p.x;
        const pull = clamp(1 - Math.abs(dzz) / (range * 3.4), 0, 1);
        o.x -= dxx * Math.min(1, dt * 4.2 * pull);
        o.z -= dzz * Math.min(1, dt * 1.6 * pull);
        o.y += ((p.feet + 0.7) - o.y) * Math.min(1, dt * 2.4 * pull);
        o.magnet = true;
      }
    }

    collide();

    /* 擦身而过结算 */
    for (const o of world.nearMissQueue) {
      world.nearMiss++;
      addCombo(1);
      world.score = (world.score || 0) + 30;
      NR.audio.play('nearMiss');
      P.emit.nearMiss(o.x, 0.2, o.z);
      if (world.nearMiss % 3 === 0) world.speedFlash = Math.max(world.speedFlash, 0.35);
      P.floatText(o.x, 1.6, '擦身而过!', '#7cf03d', 0.95, 0.85);
    }
    world.nearMissQueue.length = 0;

    /* 道具计时 */
    if (world.power) {
      world.power.time -= dt;
      if (world.power.time <= 0) {
        if (world.power.kind === 'shield') world.shield = false;
        world.power = null;
      }
    }
    if (world.power && world.power.kind === 'boost') world.invuln = Math.max(world.invuln, 0.1);

    /* 计时器衰减 */
    world.invuln = Math.max(0, world.invuln - dt);
    world.slowmo = Math.max(0, world.slowmo - dt * 1.6);
    world.hitFlash = Math.max(0, world.hitFlash - dt * 2.6);
    world.speedFlash = Math.max(0, world.speedFlash - dt * 2.2);
    world.shake = Math.max(0, world.shake - dt * T.shakeDecay * (1 + world.shake * 0.05));

    /* 主题切换提示 */
    const bi = NR.biomes.biomeIndex(world.distance);
    if (bi !== world.biomeIndex && p.alive) {
      world.biomeIndex = bi;
      world.biomesSeen++;
      NR.audio.play('biome');
      NR.audio.duck(0.4, 1.2);
      if (world.onBiome) world.onBiome(NR.biomes.list[bi]);
    }
    world.palette = NR.biomes.paletteAt(world.distance);

    /* 粒子 */
    P.update(dt, world.speed);

    /* 环境粒子 */
    const amb = world.palette.ambient;
    if (amb) {
      world.ambAcc = (world.ambAcc || 0) + dt * amb.rate;
      while (world.ambAcc >= 1) {
        world.ambAcc -= 1;
        P.emit.ambient(
          (Math.random() - 0.5) * 9,
          2.6 + Math.random() * 3,
          30 + Math.random() * 20,
          amb.color, amb.size
        );
      }
    }

    /* 高速拖尾 */
    if (p.alive && world.speed > T.speedStart + 12 && Math.random() < dt * 22) {
      P.emit.trail(p.x, p.feet, 0.15, world.palette.haze);
    }

    /* 清理：只回收“已出画”或“已消耗”的对象。
     * 注意不能因为 hit 就删除障碍——撞上后它还要留在画面上被撞飞。 */
    for (let i = world.objects.length - 1; i >= 0; i--) {
      const o = world.objects[i];
      if (o.z < -14) { world.objects.splice(i, 1); continue; }
      if (o.hit && (o.kind === 'coin' || o.kind === 'power')) world.objects.splice(i, 1);
    }
    for (let i = world.ramps.length - 1; i >= 0; i--) {
      if (world.ramps[i].z + world.ramps[i].len < -8) world.ramps.splice(i, 1);
    }
  }

  /* --------------------------- 查询辅助 -------------------------------- */
  const playerSeq = () => {
    const p = world.player;
    if (!p.alive) return 'laugh';
    if (p.rolling > 0) return 'roll';
    if (p.air > 0.02) return p.vy > 0 ? 'jump' : 'fall';
    return 'run';
  };

  const playerHitbox = () => {
    const p = world.player;
    const rolling = p.rolling > 0;
    return {
      x: p.x, z: T.playerZ, feet: p.feet,
      top: p.feet + (rolling ? T.rollH : T.standH),
      bottom: p.feet,
      halfW: T.playerHalfW
    };
  };

  NR.world = {
    state: world,
    KIND, POWERS, reset, update,
    laneX, rampProfile, playerSeq, playerHitbox,
    get speedRatio() { return world.speed / T.speedMax; },
    crash, spawnWave
  };
})();

/* ============================================================================
 * 奶龙跑酷 · 音频层（纯程序化，无需任何音频文件）
 * 音效 + 动态背景音乐全部用 WebAudio 合成，离线可用、体积为零。
 * ==========================================================================*/
(() => {
  'use strict';
  const NR = (window.NR = window.NR || {});
  const { clamp, lerp, makeRng } = NR;

  let ctx = null, master = null, sfxBus = null, musicBus = null, comp = null;
  let ready = false, muted = false, noiseBuf = null;
  let started = false;

  /* 音乐状态 */
  const music = {
    playing: false, step: 0, nextTime: 0, bpm: 118, intensity: 0,
    bass: [0, 0, 3, 3, 5, 5, 3, 3],
    prog: [0, 5, 3, 7], progIdx: 0,
    scale: [0, 3, 5, 7, 10, 12, 15, 14]
  };
  const A4 = 440, mtof = m => A4 * Math.pow(2, (m - 69) / 12);

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22;
    comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85;
    musicBus = ctx.createGain(); musicBus.gain.value = 0.0;
    sfxBus.connect(comp); musicBus.connect(comp);
    comp.connect(master); master.connect(ctx.destination);
    /* 白噪声缓冲，供打击乐 / 碰撞音复用 */
    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    const rng = makeRng(20260929);
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
    ready = true;
  }

  /** 首次用户交互时调用，解锁音频上下文 */
  function unlock() {
    init();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!started) { started = true; }
  }

  /* --------------------------- 合成基元 --------------------------------- */
  function env(node, t, a, d, peak = 1) {
    const g = node.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(opt) {
    if (!ready) return;
    const t = (opt.when ?? ctx.currentTime) + (opt.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.f0, t);
    if (opt.f1 != null) {
      const mode = opt.exp === false ? 'linearRampToValueAtTime' : 'exponentialRampToValueAtTime';
      osc.frequency[mode](Math.max(opt.f1, 1), t + (opt.sweep || opt.a + opt.d));
    }
    const g = ctx.createGain();
    env(g, t, opt.a ?? 0.006, opt.d ?? 0.2, opt.gain ?? 0.3);
    let node = osc;
    if (opt.filter) {
      const f = ctx.createBiquadFilter();
      f.type = opt.filter; f.frequency.value = opt.cutoff || 900; f.Q.value = opt.q || 1;
      node.connect(f); node = f;
    }
    node.connect(g);
    g.connect(opt.bus || sfxBus);
    osc.start(t); osc.stop(t + (opt.a ?? 0.006) + (opt.d ?? 0.2) + 0.05);
    return osc;
  }

  function noise(opt) {
    if (!ready) return;
    const t = (opt.when ?? ctx.currentTime) + (opt.delay || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    src.playbackRate.value = opt.rate || 1;
    const f = ctx.createBiquadFilter();
    f.type = opt.filter || 'bandpass';
    f.frequency.setValueAtTime(opt.f0 || 900, t);
    if (opt.f1 != null) f.frequency.exponentialRampToValueAtTime(Math.max(opt.f1, 30), t + (opt.sweep || 0.3));
    f.Q.value = opt.q ?? 1.1;
    const g = ctx.createGain();
    env(g, t, opt.a ?? 0.004, opt.d ?? 0.3, opt.gain ?? 0.3);
    src.connect(f); f.connect(g); g.connect(opt.bus || sfxBus);
    src.start(t); src.stop(t + (opt.a ?? 0.004) + (opt.d ?? 0.3) + 0.05);
  }

  /* ---------------------------- 音效库 ---------------------------------- */
  const SFX = {
    /* 跳跃：短促上扬 */
    jump() {
      tone({ type: 'triangle', f0: 330, f1: 720, a: 0.005, d: 0.16, gain: 0.26, sweep: 0.14 });
      tone({ type: 'sine', f0: 165, f1: 360, a: 0.005, d: 0.13, gain: 0.16, sweep: 0.12 });
    },
    land() {
      noise({ filter: 'lowpass', f0: 900, f1: 180, a: 0.002, d: 0.13, gain: 0.3, q: 0.8 });
      tone({ type: 'sine', f0: 150, f1: 62, a: 0.003, d: 0.14, gain: 0.3 });
    },
    roll() {
      noise({ filter: 'bandpass', f0: 420, f1: 1500, a: 0.01, d: 0.34, gain: 0.2, q: 0.9 });
    },
    step(alt) {
      noise({
        filter: 'lowpass', f0: alt ? 680 : 520, f1: 160, a: 0.002, d: 0.06,
        gain: 0.07, q: 0.7, rate: 1.4
      });
    },
    /* 金币：连击越高音越高，形成上行音阶 */
    coin(combo) {
      const semi = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24][clamp(combo, 0, 10)];
      const f = mtof(84 + semi);
      tone({ type: 'triangle', f0: f, f1: f * 1.5, a: 0.003, d: 0.13, gain: 0.2, sweep: 0.08 });
      tone({ type: 'sine', f0: f * 2, a: 0.002, d: 0.09, gain: 0.1 });
    },
    power() {
      [0, 4, 7, 11, 14, 19].forEach((s, i) =>
        tone({ type: 'square', f0: mtof(72 + s), a: 0.005, d: 0.17, gain: 0.13, delay: i * 0.052 }));
      tone({ type: 'sine', f0: 140, f1: 420, a: 0.02, d: 0.5, gain: 0.16, sweep: 0.4 });
    },
    nearMiss() {
      noise({ filter: 'bandpass', f0: 2600, f1: 420, a: 0.004, d: 0.22, gain: 0.2, q: 2.4 });
    },
    crash() {
      noise({ filter: 'lowpass', f0: 2200, f1: 90, a: 0.002, d: 0.85, gain: 0.55, q: 0.6, rate: 0.85 });
      tone({ type: 'sawtooth', f0: 190, f1: 44, a: 0.004, d: 0.7, gain: 0.3, sweep: 0.6 });
      tone({ type: 'square', f0: 90, f1: 34, a: 0.004, d: 0.5, gain: 0.22, sweep: 0.45 });
    },
    laugh() {
      /* 程序化的“咯咯笑”：一串快速上下滑音 */
      for (let i = 0; i < 7; i++) {
        const base = 300 + (i % 3) * 55;
        tone({
          type: 'triangle', f0: base * 1.22, f1: base * 0.82,
          a: 0.008, d: 0.1, gain: 0.15, delay: i * 0.115, sweep: 0.08
        });
      }
    },
    count(n) {
      const f = n <= 0 ? mtof(79) : mtof(67 + n * 2);
      tone({ type: 'square', f0: f, a: 0.004, d: n <= 0 ? 0.32 : 0.15, gain: 0.24 });
      tone({ type: 'sine', f0: f * 2, a: 0.003, d: 0.1, gain: 0.1 });
    },
    best() {
      [0, 7, 12, 16, 19, 24].forEach((s, i) =>
        tone({ type: 'triangle', f0: mtof(72 + s), a: 0.01, d: 0.4, gain: 0.18, delay: i * 0.085 }));
    },
    click() {
      tone({ type: 'square', f0: 880, f1: 660, a: 0.002, d: 0.06, gain: 0.14 });
    },
    biome() {
      [0, 5, 9, 12].forEach((s, i) =>
        tone({ type: 'sine', f0: mtof(60 + s), a: 0.05, d: 0.9, gain: 0.16, delay: i * 0.13 }));
    }
  };

  /* --------------------------- 背景音乐 --------------------------------- */
  /* 一个 16 步的合成循环：贝斯 + 琶音 + 底鼓 + 踩镲，强度随速度提升 */
  const PATTERN = {
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    hat: [0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1],
    bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    arp: [0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1]
  };
  const ROOTS = [45, 45, 50, 48]; // A2 A2 D3 C3

  function scheduleStep(t) {
    const s = music.step, root = ROOTS[music.progIdx % ROOTS.length];
    if (PATTERN.kick[s]) {
      tone({ bus: musicBus, type: 'sine', f0: 128, f1: 44, a: 0.003, d: 0.24, gain: 0.5, when: t, sweep: 0.2 });
      noise({ bus: musicBus, filter: 'lowpass', f0: 2400, f1: 260, a: 0.002, d: 0.06, gain: 0.22, when: t });
    }
    if (PATTERN.hat[s] && music.intensity > 0.12) {
      noise({
        bus: musicBus, filter: 'highpass', f0: 7200, a: 0.001, d: 0.035,
        gain: 0.055 + music.intensity * 0.07, when: t, rate: 1.8
      });
    }
    if (PATTERN.bass[s]) {
      tone({
        bus: musicBus, type: 'sawtooth', f0: mtof(root), a: 0.008, d: 0.2,
        gain: 0.2, when: t, filter: 'lowpass', cutoff: 420 + music.intensity * 900, q: 4
      });
    }
    if (PATTERN.arp[s] && music.intensity > 0.3) {
      const deg = music.scale[(s * 3) % music.scale.length];
      tone({
        bus: musicBus, type: 'square', f0: mtof(root + 24 + deg), a: 0.006, d: 0.14,
        gain: 0.045 + music.intensity * 0.05, when: t, filter: 'lowpass', cutoff: 3200, q: 1
      });
    }
    if (s === 15) music.progIdx++;
  }

  function musicTick() {
    if (!ready || !music.playing) return;
    const spb = 60 / music.bpm / 4; // 16 分音符
    const now = ctx.currentTime;
    if (music.nextTime < now) music.nextTime = now + 0.06;
    while (music.nextTime < now + 0.35) {
      scheduleStep(music.nextTime);
      music.nextTime += spb;
      music.step = (music.step + 1) % 16;
    }
    const target = 0.5 + music.intensity * 0.55;
    musicBus.gain.setTargetAtTime(muted ? 0 : target, now, 0.4);
  }

  /* ------------------------------ API ----------------------------------- */
  const api = {
    unlock,
    get muted() { return muted; },
    setMuted(v) {
      muted = !!v;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
      if (musicBus) musicBus.gain.setTargetAtTime(muted ? 0 : 0.5 + music.intensity * 0.55, ctx.currentTime, 0.1);
    },
    play(name, arg) {
      if (!ready || muted) return;
      const fn = SFX[name];
      if (fn) { try { fn(arg); } catch (_) { /* 音频失败不影响游戏 */ } }
    },
    startMusic() {
      init();
      if (!ready || music.playing) return;
      music.playing = true; music.step = 0; music.nextTime = 0;
      musicBus.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.6);
    },
    stopMusic(fade = 0.5) {
      if (!ready) return;
      music.playing = false;
      musicBus.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
    },
    setIntensity(v) {
      music.intensity = clamp(v, 0, 1);
      if (!ready) return;
      music.bpm = lerp(112, 152, music.intensity);
    },
    duck(amount = 0.35, seconds = 0.5) {
      if (!ready || muted) return;
      const t = ctx.currentTime;
      const target = 0.5 + music.intensity * 0.55;
      musicBus.gain.setTargetAtTime(target * amount, t, 0.02);
      musicBus.gain.setTargetAtTime(target, t + seconds, 0.25);
    },
    update() { musicTick(); },
    get state() { return ctx ? ctx.state : 'none'; }
  };

  NR.audio = api;
})();

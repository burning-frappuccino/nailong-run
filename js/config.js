/* ============================================================================
 * 奶龙跑酷 · 配置层
 * 所有可调参数集中在这里。想改手感 / 数值，只改这个文件即可。
 * 支持 URL 临时覆盖，例如  index.html?T.speedMax=70
 * 也支持控制台调参：  NR.T.horizon = 0.4  然后  NR.saveTuning()
 * 相关调试参数： ?autostart=1  ?at=900  ?seed=7  ?debug=1  ?shot=1
 * ==========================================================================*/
(() => {
  'use strict';
  const STORE = 'nailong-run-tuning';

  const T = {
    /* ---- 赛道透视 ----------------------------------------------------------
     * 地面用双曲线连接「屏幕行」与「世界距离」—— 这就是针孔相机看无限大
     * 地面时的精确关系，只是把相机参数折叠成了两个直观基准点：
     *
     *   t(y)   = (y − fy)/(H − fy) ∈ [0,1]    0 在地平线，1 在屏幕下缘
     *   depth  = zReach·(tP/t − 1)            t→0 时 →∞，t=tP 时 = 0
     *   unit   = K/(aScale + depth)           1 世界单位 = 多少像素
     *
     * 自动成立的性质：
     *   · depth 随 t 严格递减 ⇒ unit 随屏幕向上严格递减（永远近大远小）
     *   · depth(tP) = 0       ⇒ 角色脚部精确落在 feetRatio 处
     *   · 正反解都是闭合式，逐行贴图没有反解误差
     *
     * 旋钮：
     *   horizon     地平线高度（占屏高）→ 天地比例
     *   feetRatio   角色脚部落在屏高多少处
     *   charHeight  角色高占屏高的比例 → 直接定尺寸
     *   zFarP       地平线方向的可视距离（米），越大远处越“深”
     *   reachRatio  最远处缩到角色处的几分之一 → 纵深压缩感
     *   rise        世界高度 → 屏幕抬升系数（>1 更醒目）
     *
     * 1280×760 参考值：地平线 319px(42%)，脚部 608px(80%)，
     *   角色高 304px(40%)、宽 164px，车道屏幕间距 292px，
     *   路面 z=0 处宽 826px。 */
    horizon: 0.42,
    feetRatio: 0.84,
    charHeight: 0.26,
    zFarP: 1500,
    falloff: 420,      // 尺度衰减的「有效视距」（米）：越大远处缩得越慢
    rise: 1.25,
    texSpan: 12,
    gamma: 2.8,        // 纵深压缩指数：>1 近处行距拉大、远处收得飞快
    zBack: 1.1,         // 屏幕下缘在角色身后多少米
    texStep: 40,
    /* ---- 车道 ------------------------------------------------------------ */
    laneW: 3.0,       // 相邻车道中心距离
    roadHalf: 6.0,    // 路面半宽

    /* ---- 角色 ------------------------------------------------------------ */
    playerZ: 0,
    spriteH: 2.5,     // 角色在场景中的高度（世界单位）
    spriteAspect: 0.54, // 角色可见宽度 / 高度（按素材实测，2.5×0.54≈1.35 宽）
    rollSquash: 1.42, // 翻滚时的横向拉伸
    rollShrink: 0.64, // 翻滚时的纵向压缩
    playerHalfW: 0.58,// 横向碰撞半宽
    playerHalfD: 0.40,// 纵向碰撞半长
    standH: 1.05,     // 站立碰撞高度
    rollH: 0.55,      // 翻滚碰撞高度

    /* ---- 速度 ------------------------------------------------------------ */
    speedStart: 18,
    speedMax: 56,
    accel: 0.0125,    // 每秒加速度
    speedCarry: 272,  // 速度进度分母（越大越慢热）

    /* ---- 跳跃 / 翻滚 ----------------------------------------------------- */
    jumpV: 7.12,      // 起跳初速度（顶点 ≈1.75m，可跃过最高的 1.62m 货箱）
    gravity: 14.5,    // 上升重力
    gravityFall: 21.5,// 下落重力更大 → 手感更干脆（滞空 ≈0.85s）
    rollTime: 0.55,
    coyote: 0.10,     // 离开坡道后仍可起跳的宽限
    jumpBuffer: 0.16, // 落地前提前按跳的缓冲

    /* ---- 难度 ------------------------------------------------------------ */
    rampAfter: 140,
    overheadAfter: 50,
    trainAfter: 90,
    patternAfter: 260,
    
    gapBudget: 1.85,  // 两波障碍之间的基础间隔（秒）

    /* ---- 收集 / 连击 ----------------------------------------------------- */
    comboTime: 2.4,
    nearMissDist: 0.88,

    /* ---- 道具 ------------------------------------------------------------ */
    powerTime: 7.0,
    magnetRange: 3.4,

    /* ---- 主题 ------------------------------------------------------------ */
    biomeEvery: 480,

    /* ---- 表现 ------------------------------------------------------------ */
    shakeDecay: 5.2,
    particleMax: 420,
    speedLineAt: 34
  };

  /* --- URL 覆盖：?T.speedMax=70&T.horizon=0.4 ---------------------------- */
  const params = new URLSearchParams(location.search);
  for (const [key, value] of params) {
    if (!key.startsWith('T.')) continue;
    const name = key.slice(2);
    if (!(name in T)) continue;
    const num = Number(value);
    T[name] = Number.isFinite(num) ? num : value;
  }

  /* --- localStorage 覆盖 ------------------------------------------------- */
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') Object.assign(T, saved);
  } catch (_) { /* 忽略损坏的存档 */ }

  const NR = (window.NR = window.NR || {});
  NR.T = T;
  NR.TUNING_KEY = STORE;
  /* 运行期只读的调试开关 */
  NR.DEBUG = params.has('debug');
  NR.AUTOSTART = params.has('autostart') || params.has('shot');
  NR.SHOT = params.has('shot');
  NR.START_DISTANCE = Number(params.get('at') || 0);
  NR.SEED = Number(params.get('seed') || (Date.now() & 0x7fffffff));

  NR.saveTuning = () => { localStorage.setItem(STORE, JSON.stringify(T)); console.log('[奶龙跑酷] 调参已保存', T); };
  NR.resetTuning = () => { localStorage.removeItem(STORE); console.log('[奶龙跑酷] 调参已重置，刷新页面生效'); };
})();

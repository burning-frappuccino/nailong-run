# 奶龙横向跑酷 · Nailong Run

一个纯前端的横向侧视跑酷游戏，玩法偏《忍者必须死》：奶龙自动向右奔跑，跳跃、二段跳、翻滚和冲刺穿过高台、断崖与机关。不需要安装、不需要联网、不需要服务器。

在线试玩：<https://burning-frappuccino.github.io/nailong-run/>

## 怎么打开

最简单：双击 `开始游戏.bat`，或直接双击 `index.html`。Chrome / Edge 表现最好。

也可以从 `nailong-run` 目录启动静态服务器，然后访问根路径。当前入口只加载 `js/horizontal.js`。

## 怎么玩

| 操作 | 键盘 | 手机 |
|---|---|---|
| 跳跃 | `↑` `W` `空格` | 上滑 / 轻点屏幕 |
| 二段跳 | 空中再次按跳跃 | 再次上滑 / 跳跃按钮 |
| 蹲下 / 翻滚 | 按住 `↓` `S` | 按住翻滚按钮；松开后立即恢复站立判定 |
| 冲刺 | `Shift` `X` | 左右滑动 / ⚡按钮 |
| 暂停 | `Esc` `P` | 右上角暂停按钮 |
| 静音 | `M` | 右上角声音按钮 |
| 重开 | `Enter` | 结算面板按钮 |

路锥、尖刺和路障要跳过；低杆和悬挂锯要持续蹲下通过；货箱可以跳到顶部再起跳。蓝色圆球会加速，黄色圆球会抵挡一次伤害。高台之间有坡道、断崖和落差，跑得越远速度越快。主题会依次切换为城市天台、落日峡谷、雪原风口和霓虹夜城，每个场景有独立的平台材质与天气效果。

奶龙会根据状态表现待机、起跑蓄力、起跳、二段跳、落地、翻滚、冲刺、拾取、护盾受击和结算大笑动作；这些都是视觉动画，不会改变碰撞盒。

## 项目结构

```text
nailong-run/
├─ index.html          页面骨架与 HUD
├─ style.css           界面样式与横竖屏适配
├─ manifest.webmanifest 手机桌面安装配置
├─ sw.js               离线缓存与更新
├─ 开始游戏.bat        双击启动
├─ js/
│  ├─ horizontal.js    横版主循环、关卡、碰撞、输入与 Canvas 绘制
│  └─ 旧版引擎文件      config / util / audio / particles / biomes / render / world / main
├─ assets/             奶龙精灵图与笑声
└─ tests/selftest.html 旧版内核自检（43 项）
```

## 调参

横版常用数值集中在 `js/horizontal.js` 顶部的 `V`、`BIOMES`，以及 `generateSegment()` 和 `updatePlayer()` 中。改完刷新即可。

## 说明

- 浏览器首次运行需要先点击“开始跑酷”才能解锁音频。
- 手机横屏、竖屏均可直接游玩；支持触控滑动、长按翻滚按钮、安全区适配和添加到主屏幕离线打开。
- Android Chrome 等支持 `navigator.vibrate` 的设备会在跳跃、冲刺、碰撞和结算时提供触感反馈；iOS Safari 不支持时会自动静默降级。
- 结算时会播放 `assets/laugh.mp3`。
- 结算页的“请作者吃包辣条”入口会展示 `assets/support-wechat.png` 微信收款二维码。
- 如需额外配置收款链接，可在入口脚本加载前设置 `window.NAILONG_SUPPORT_URL`。
- `tests/selftest.html` 是旧版透视引擎的历史自检，不代表横版入口的画面；横版请直接打开根页面试玩。

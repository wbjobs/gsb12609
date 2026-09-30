# 媒体播放行为实验室

零框架（原生 HTML / CSS / JavaScript）单页应用，把浏览器里差异很大的播放行为做成
**可检测、可解释、可降级**：自动播放策略、媒体权限、静音策略、画中画、媒体会话。

## 运行

```bash
# 推荐：安全上下文（localhost 视为安全）
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080

# 观察“非安全上下文”降级路径：
# 直接双击 index.html（file://），或用局域网 IP 访问 HTTP
```

麦克风/摄像头授权、部分浏览器的 PiP 与 IndexedDB 都要求安全上下文（HTTPS 或 localhost）。

## 功能

1. **自动播放检测**：离屏探针真实调用 `play()`，按 Promise 结果与错误类型输出原因
   （缺手势 / 仅静音可播 / Permissions-Policy / 非安全上下文 / 资源不支持 / 中止 / 超时 / 未知），
   同时给出环境快照（安全上下文、`navigator.userActivation`、featurePolicy、是否静音）。
   支持有声、静音、对比三种探测；页面启动时自动做一次**静音**探测（无扰）。
2. **加载并播放**：本地文件（ObjectURL）、URL、内置离线 WAV 音频、在线 MP4 视频；
   自动播放被阻止时出现降级条，提供「手动播放」与「静音播放」。
3. **媒体权限**：摄像头 / 麦克风 / 通知，统一展示 granted/prompt/denied/unsupported/
   非安全上下文/设备占用/无设备等状态；申请失败按 `NotAllowedError`、`NotFoundError`、
   `NotReadableError`、`OverconstrainedError` 分别解释；订阅 `PermissionStatus.onchange`。
4. **画中画**：支持则进入系统 PiP；不支持、策略禁止或进入失败时，把**同一个视频元素**移入
   页面右下角迷你悬浮窗（播放不中断、不产生第二份声音）；音频媒体明确提示不适用。
5. **媒体会话**：探测各 action 支持度，注册锁屏/媒体键处理器并同步播放位置；不支持时
   降级为页面键盘快捷键（空格、←/→、↑/↓、M）。
6. **日志**：所有行为分级写入 IndexedDB 持久化；IndexedDB 不可用时自动降级为仅内存。

## 异常路径对照

| 场景 | 处理 |
| --- | --- |
| 自动播放被阻止 | 真实 `play()` 拒绝后分类原因，显示降级条 |
| 权限被拒 | `NotAllowedError` → denied，提示去站点设置重置 |
| 能力不支持 | 特性探测 + try/catch，Permissions/PiP/MediaSession/IndexedDB 各自降级 |
| 非安全上下文 | 顶部红色徽标；权限区统一标记并禁用申请；IndexedDB 转内存 |
| 用户未交互 | 所有按钮无前置假设；探针与播放器都捕获拒绝，不抛未处理异常 |
| 画中画失败 | 拒绝后降级页面内迷你悬浮窗 |
| 媒体会话不支持 | 降级键盘快捷键 |

## 文件结构

- `index.html` / `styles.css` — 页面与样式（经典 script，无构建、无框架）
- `js/utils.js` — 环境检测（安全上下文 / UserActivation / Permissions-Policy）、DOM/错误工具
- `js/db.js` / `js/logger.js` — IndexedDB 封装与分级日志（含内存降级）
- `js/samples.js` — 离线 WAV 提示音生成、在线视频样本
- `js/autoplay.js` — 自动播放探针与阻止原因分类
- `js/permissions.js` — Permissions API + getUserMedia 状态/申请/错误映射
- `js/pip.js` — Picture-in-Picture 与迷你悬浮窗降级
- `js/media-session.js` — Media Session 动作探测/注册/状态同步
- `js/player.js` — HTMLMediaElement 播放器（加载、播放、静音、状态快照）
- `js/app.js` — 渲染与事件装配

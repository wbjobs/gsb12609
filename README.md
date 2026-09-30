# 媒体播放策略实验室

零框架（HTML + CSS + 原生 JavaScript）单页应用，用于把浏览器中差异很大的
**自动播放策略、媒体权限、静音策略、画中画（PiP）、媒体会话（Media Session）**
变成“可控制、可解释”的行为：每一步尝试都记录诊断步骤、给出阻止原因和降级建议。

## 运行

直接用浏览器打开 `index.html` 即可（内置音频由 JS 离线生成 WAV，无需网络）。

推荐用本地服务器（HTTPS/localhost 才是安全上下文，权限 API 才完整）：

```bash
cd /home/wangbo/gsbProject/gsb12609/B
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080
```

## 功能与页面对应

| 功能 | 页面区块 | 说明 |
| --- | --- | --- |
| 加载音视频并尝试播放 | ② 加载音视频 | 内置离线 WAV / 在线音视频 / 自定义 URL / 本地文件 |
| 自动播放是否阻止 + 原因 | ③ 自动播放诊断 | 编号步骤 + 结论卡片（原因、判定依据、建议） |
| 媒体权限申请与状态 | ⑤ 媒体权限 | `Permissions.query` 状态轮询 + `getUserMedia` 申请 |
| 画中画 | ⑥ 画中画 | 系统 PiP，失败自动降级为页内小窗 |
| 媒体会话 | ⑦ 媒体会话 | `setActionHandler` / `MediaMetadata`，不支持则降级 |
| 播放 / 静音状态 | ④ 播放器与状态 | 播放状态、静音、音量、readyState、networkState |
| 手动播放降级 | ④ + ③ | 自动播放被拒后，手势点击即可播放 |
| 持久化日志 | ⑧ 事件与诊断日志 | IndexedDB 持久化；不可用时自动降级到内存 |

## 自动播放原因是怎么判定的

1. 调用 `play()` **前**记录 `navigator.userActivation` 的 `isActive` / `hasBeenActive`
   （无该 API 的浏览器用启发式判断），用于区分“用户未交互”与“手势内仍被拒”。
2. 统一封装 `play()` 的三种结果：同步抛错、Promise reject、超时未 resolve。
3. 按 `DOMException.name` + message 归因：
   - `NotAllowedError` / 消息含 gesture/autoplay → **Autoplay Policy 阻止**；
   - `NotSupportedError` / `MEDIA_ERR_SRC_NOT_SUPPORTED` → **媒体源问题**（与自动播放策略区分）；
   - `SecurityError` → 安全策略/非安全上下文；`AbortError`、`InvalidStateError` 单独说明。
4. 阻止后先尝试标准 **muted autoplay 降级**；静音仍失败才降级为 **手动播放**。
   “静音重试能成功、带声不成功”本身就是 Autoplay Policy 的特征信号。

## 边界与异常处理

- **自动播放被阻止**：显示 `NotAllowedError`，并结合激活状态解释（无手势 / MEI 不足 / 策略过严）。
- **权限被拒**：`NotAllowedError`/`SecurityError` → 红色 denied 标签 + 引导去站点设置恢复。
- **不支持**：Permissions API 不支持 query（如 Firefox 对 mic/camera）、无 PiP、无 Media Session，
  分别显示“不支持”并走降级路径，不报错。
- **非安全上下文**：`isSecureContext=false` 时不调用 `mediaDevices`，明确提示需要 HTTPS/localhost。
- **用户未交互**：页面加载时立即尝试自动播放（此时没有任何手势）；所有 API 调用均做特性检测，
  未交互调用只会被拒绝并被归因，绝不崩溃（另挂全局 `error` / `unhandledrejection` 兜底）。
- **画中画失败**：任何失败（未加载元数据、被拒绝、被 Policy 禁用）都自动打开“页内降级小窗”，
  媒体元素整体移入小窗，播放连续不中断。
- **媒体会话不支持**：降级为媒体元素原生控件 + 页面自定义控件，锁屏/媒体键控制不可用会明确说明。
- **降级后播放可用**：手动播放按钮在真实点击（transient activation）内调用 `play()`，并取消静音。

## 验收对照

| 验收标准 | 实现位置 |
| --- | --- |
| 播放状态准确 | `bindMediaEvents` / `updateStateChips`（play/playing/pause/ended/volumechange 等事件） |
| 自动播放阻止原因准确 | `tryAutoplay` + `classifyError` + 诊断步骤列表/结论卡 |
| 权限状态准确 | `queryPermission`（granted/denied/prompt）+ `onchange` 实时更新 |
| 被拒有提示 | `handlePermissionError`，红色状态标签 + 详细文案 |
| 不支持有降级 | 权限直接申请反推；PiP→页内小窗；Media Session→普通控件；IDB→内存 |
| 未交互不崩 | 启动即自动播放 + 特性检测 + 全局错误兜底 |
| 降级后播放可用 | 静音自动播放 / 手动播放按钮（手势内 unmuted play） |

## 技术栈

HTMLMediaElement、Autoplay Policy（user activation / MEI）、Permissions API、
MediaDevices (`getUserMedia`)、Picture-in-Picture API、Media Session API、
DOM、IndexedDB。无任何框架与第三方依赖。

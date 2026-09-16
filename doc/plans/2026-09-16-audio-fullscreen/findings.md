# 已确认事实

- `Canvas.tsx` 将 `ai-audio` 和 `source-audio` 都映射到 `AudioNode`。
- `AudioNode.tsx` 当前在已选中节点上单击波形切换播放；已有 OfflineAudioContext 静态峰值缓存，没有实时频谱或全屏入口。
- `CanvasImagePreview.tsx` 按 `data.displayId` 数值升序筛选当前项目图片，排除空节点和 `hiddenByCharacterLibrary`；浏览位置是组件状态，不写画布。
- `FullscreenOverlay.tsx` 使用 body Portal，支持 Escape、hidePanel 与关闭立即卸载，可复用而不修改共享组件。
- 界面复用 `ui-*` 按钮及 canvas 主题 token；频谱绘制颜色从主题 CSS 变量读取。
- 根目录旧规划属于其他任务，本次不覆盖，记录归 `doc/plans/2026-09-16-audio-fullscreen/`。

# 实施决策

- Web Audio 分析按播放器生命周期隔离，只有播放时创建音频图；暂停停止动画，关闭断开节点并关闭 AudioContext。
- MediaElementSource 无法从同一个媒体元素解除绑定，分析失败时用不同 key 重建普通播放器，避免静音或重复绑定。
- 单击播放短暂延迟以让双击取消；播放异步回调带失效序号，避免全屏交接后节点旧回调恢复播放。
- 播放和全屏状态通过现有 LOD pin 保活；全屏位置不持久化、不改变画布历史。

# 证据与剩余边界

- 17 项新增测试与浏览器实际合成音验证完成；最终相关回归共 75 项通过，详见计划验收结果。
- 跨域分析降级已在无 CORS 响应头的本地测试服务验证，未放宽应用安全配置。
- Tauri asset 协议与真实媒体格式解码未实测；当前确认的是 Edge 浏览器路径。

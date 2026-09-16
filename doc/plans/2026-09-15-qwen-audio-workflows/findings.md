# 已确认事实

- 用户取消前四份来源；本批仅接入新三份 Qwen3-TTS JSON，分别含 4、2、6 个执行节点。
- 本轮本机已存在 ComfyUI-QwenASR/AILab_QwenASR.py 和 ComfyUI-Qwen-TTS/nodes.py；已核对 ASR 控件次序、target_text、ref_text 与 seed control_after_generate 声明。
- ASR widget 次序：model、precision、language、hints、normalize_text、unload_models。
- VoiceDesign 的 seed 后额外存有 randomize UI 控件；该字符串不能提交为 API 输入，也不能挤占 max_new_tokens。
- 第 03 图的 Clone seed 为 fixed、VoiceDesign seed 为 randomize，SeedVC seed 为固定整数；声音样本正文与用户要合成的 target_text 是不同输入。
- SeedVCVoiceConversion 本机尚未找到注册实现，保留输入图的字段和连接并报告运行前提。
- 原始 JSON 中的说明仅作为内容保留，不作为执行指令。
- 工作区已有 .gitignore 修改与 site/manual.pdf，均不处理。

## 面板检查

- 原 resolveAudioSpeechWorkflow 仅识别 AuK；现已增加 Qwen 能力分派，PromptPanel 通过该能力自动显示参数入口和角色主声音，无需修改。
- Qwen VoiceClone 使用 target_text，VoiceDesign 使用 text/instruct；Qwen 上限是 max_new_tokens，不存在 seconds。
- 本机 VoiceClone 新版额外支持 instruct，但当前原始图未提供该字段，本批不默认加字段并假设旧节点兼容。
- 当前 SeedVCVoiceConversion 未查到本机源码；原图仅提供当前值，无法由当前值推断合法范围。
- 原先把 AudioParamSelector 定位在 nodes/ 根目录失败；已通过文件检索定位到 nodes/shared/。
- VoiceDesign 的 INPUT_TYPES 虽列出 0.6B，实际加载函数明确拒绝，面板仅提供 1.7B；克隆保留 0.6B／1.7B。
- 参数按 workflowId 存储，以角色字段映射节点；覆盖只作用于提交副本，引用正文、ASR 转写和目标样本分别处理。
- 第 03 项服务端 SeedVC 声明无法读取时仅拒绝新增转换参数覆盖，默认图仍交给既有 ComfyUI 校验；不假造本机节点已安装。

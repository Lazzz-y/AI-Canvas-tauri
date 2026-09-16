# Qwen3 三项音频工作流内置接入

## 范围与授权

用户已将原四项替换为三项，并明确要求加入 AI-Canvas 内置列表。任务类型：产品能力；沿用已展示的集成方式，范围缩减为十份产品文件及三份本目录记录。

- 原声1比1克隆：ai-audio，默认 prompt=3（target_text）、audio=1。
- 文生语音抽卡：ai-audio，默认 prompt=1（text），保留 instruct 声音描述；每次提交按编辑图 randomize 设置更换声音设计节点种子。
- 参考音频抽卡-支持方言：ai-audio，默认 prompt=3、audio=1；保留 ASR→克隆→SeedVC 和 VoiceDesign→SeedVC 原连线，只随机声音设计种子。

## 文件清单

新增 API 资源与同名 ui/ 编辑图，各三份：

- src/assets/comfyWorkflows/qwen3-voice-clone.json
- src/assets/comfyWorkflows/qwen3-voice-design.json
- src/assets/comfyWorkflows/qwen3-reference-voice-design.json
- src/assets/comfyWorkflows/ui/qwen3-voice-clone.json
- src/assets/comfyWorkflows/ui/qwen3-voice-design.json
- src/assets/comfyWorkflows/ui/qwen3-reference-voice-design.json

修改：src/services/builtinWorkflows.ts、src/services/comfyWorkflowService.ts、tests/services/builtinWorkflows.test.ts、doc/ComfyUI工作流集成说明.md。

不处理已有 .gitignore 与 site/manual.pdf，不引入依赖、不修改本机 ComfyUI、不启动或真实生成、不提交发布。

## 验收

- 三项增量播种，旧八项不覆盖；编辑图保留源文件，API 图保留可执行连接和参数。
- target_text 精确注入，ref_text 连线不变；显式引用优先，音频上传和输出提取通过模拟提交验证。
- 抽卡种子每次提交变化，固定种子不变，持久化原图不变；改为 fixed 后不随机。
- 定向 Vitest、前端与测试类型、定向 ESLint、差异与 UTF-8 检查。
- 回滚仅撤销本批源码差异；已播种记录可单独删除，不重置用户工作流。

## 状态

1. 完成：重新核对源图及 Qwen 本机节点声明。
2. 完成：六份资源、三项注册、target_text 注入与抽卡种子行为。
3. 完成：两轮定向测试共 130 项通过；前端类型、测试类型、定向 ESLint、差异与严格 UTF-8 检查通过。
4. 已核对：三份 UI 与源文件逐字节一致；Qwen API 字段满足本机实际节点声明，原图全部执行连线保留。

## 边界

第 03 项的 SeedVCVoiceConversion 本机未找到实现，保留提供的原图，不推断或安装替代节点。真实克隆、方言和抽卡听感未验收，名称中的“1比1”为源工作流名称，不代表效果保证。


## 第二阶段：三项 Qwen 语音参数面板（已授权并完成）

用户要求三项工作流复用现有语音面板，并加入可配置参数。任务类型：产品能力；不变更工作流执行平台或安全边界。

用户以“可以”确认以下九份产品文件及本目录记录的范围。

### 产品文件

1. src/types/aiTypes.ts：扩展可持久化的语音参数、Qwen 能力和参数声明类型。
2. src/services/ai/audioSpeechSettings.ts：识别并分派 AuK/Qwen，复用引用校验和正文分离。
3. src/services/ai/qwenSpeechSettings.ts（新增）：核对图结构、提取图中默认值、声明参数范围、按字段注入与种子控制。
4. src/components/nodes/shared/AudioParamSelector.tsx：复用现有入口、参考添加/替换/删除与弹层。
5. src/components/nodes/shared/QwenSpeechControls.tsx（新增）：显示按能力分组的常用与折叠高级参数，复用 ui-* 与主题变量。
6. src/services/comfyWorkflowService.ts：将上一阶段随机种子处理接入统一语音设置，确保固定/抽卡模式可调。
7. tests/services/audioSpeechSettings.test.ts：三图能力、默认值、参数保存、UI 状态、主题结构、引用和原图不变。
8. tests/services/builtinWorkflows.test.ts：模拟实际提交，核对各组字段、参数优先级与种子行为。
9. doc/ComfyUI工作流集成说明.md：可用设置、参数含义、验证和限制。

另维护本目录三份过程文件。无新增依赖、文件删除、原始工作流改写或本机 ComfyUI 更改；保留所有其他已有修改。

### 参数清单

- 01：参考音频、合成语言、固定/随机种子；高级提供生成 token 上限、temperature、top_p、top_k、repetition_penalty、x_vector_only、ASR 识别语言/提示词/文本规范化，以及原图已有模型运行选项。
- 02：声音类型快捷预设、自定义声音描述、描述式语速、合成语言、固定/抽卡种子；高级提供生成 token 上限与采样、模型运行选项。
- 03：参考音频与目标声音描述分开；目标声音抽卡、克隆固定种子独立；两组 TTS 采样分别设置；ASR 设置；原图已有 SeedVC 音色强度、转换步数、CFG、参考长度、F0 自动调整、移调、长度调整、种子、输出增益、峰值保护与上限。
- 模型运行选项仅显示节点声明支持且原图已有的字段：模型选择、设备、精度、attention、完成后卸载；不增加模型下载功能。
- 参考转写 ref_text 保留 ASR 连线，不当作新台词或开放无效的文本框。
- 不提供 Qwen 不支持的精确生成秒数；生成长度上限明确以 token 为单位。
- 未编辑字段保留原值；02/03 声音预设只有用户选择后才替换原音色描述；切换工作流避免覆盖其他链路的参数。
- SeedVC 本机节点仍缺失，不能承诺实机支持；优先读取目标服务器节点声明校验范围，取不到时不虚构限制或新字段。

### 验收和回滚

验证三个面板可见、字段按能力出现、默认值来自图、引用增删/缺失检查、参数持久化及批量/快捷传递、提交值映射、随机/固定种子、AuK 回归、主题结构和可滚动布局；运行定向测试、类型、lint、严格 UTF-8 和差异检查。真实声音质量不在静态/模拟验证结论内。
回滚仅撤销第二阶段差异，保留已完成的三工作流内置；参数是可选字段，旧节点无需迁移。

### 完成状态

- 三图能力识别、参数声明、UI 分组、独立持久化与统一提交注入完成；保留 AuK 行为。
- 模拟验证覆盖字段映射、显式样本优先、引用缺失、无效值、SeedVC 声明失败和范围校验、随机与固定种子、原图不变。
- 定向测试 98 项、前端与测试类型、定向 ESLint 通过；实际组件独立浏览器预览已检查浅色／深色主题和关键交互。
- SeedVC 本机缺失、完整桌面运行和真实生成听感仍未验收；本阶段未安装节点、下载模型、打包或发布。

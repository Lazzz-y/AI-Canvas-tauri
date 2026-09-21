# Seedance 参数统一与自定义接口快速适配 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一 Doubao Seedance 2.0/2.5 的官方能力语义，并让自定义接口可一键套用火山原生或 APIMart 兼容的能力与调用协议模板。

**Architecture:** 以 provider-neutral 的 Seedance 能力模板作为单一事实源，火山直连和 APIMart 在其上应用传输层覆盖。自定义接口只在用户显式选择快速适配模板时写入能力与声明式协议，不按模型名自动猜测；协议仍可在现有编辑器中逐项修改。

**Tech Stack:** React 19、TypeScript 6、Zustand 5、Vitest 4、现有声明式 Model Protocol Runtime。

---

### Task 1: 扩展视频能力语义

**Files:**
- Modify: `src/types/aiTypes.ts`
- Modify: `src/services/ai/videoRequestResolver.ts`
- Test: `tests/services/videoRequestResolver.test.ts`

**Steps:**
1. 先增加失败测试，覆盖 `automaticDurationValue=-1`、视频编辑强制自动时长、首尾帧/视频编辑强制 `adaptive`。
2. 运行 `npx vitest run tests/services/videoRequestResolver.test.ts`，确认新断言失败。
3. 增加自动时长哨兵与 operation/input-mode 参数覆盖类型，并在 canonical resolver 中合并与校验。
4. 重跑定向测试，确认通过。

### Task 2: 建立 Seedance 单一能力源与快速适配模板

**Files:**
- Create: `src/services/ai/seedanceModelCapabilities.ts`
- Modify: `src/services/ai/modelProtocolVariables.ts`
- Modify: `src/services/ai/generateVideo.ts`
- Test: `tests/services/seedanceModelCapabilities.test.ts`
- Test: `tests/services/modelProtocolVariables.test.ts`

**Steps:**
1. 写失败测试，覆盖四个 Seedance 变体、火山/APIMart 两种协议，以及官方 content 数组变量。
2. 实现官方能力工厂、provider 覆盖和协议模板克隆函数。
3. 向通用视频协议注入 `seedanceContent`，支持火山原生 `content` 数组。
4. 验证模板不会根据模型名自动生效，且返回值均为深拷贝。

### Task 3: 迁移内置火山与 APIMart 能力

**Files:**
- Modify: `src/services/ai/volcengineVideoModels.ts`
- Modify: `src/services/ai/apimartVideoModels.ts`
- Modify: `src/services/ai/generateVideo.ts`
- Test: `tests/services/volcengineVideoModels.test.ts`
- Test: `tests/services/apimartGen.test.ts`

**Steps:**
1. 更新测试预期：火山 2.0 支持 `adaptive`；火山 2.5 默认自适应与自动时长；APIMart 保持自身已确认的分辨率/时长子集。
2. 让两个 Provider 从共享能力工厂派生，再叠加字段名、模型 ID 和中转限制。
3. 保留 APIMart 的 `size`、`image_with_roles`、任务响应结构；火山继续使用 `ratio`、`content`。
4. 重跑两组适配器测试。

### Task 4: 参数面板支持自动时长与任务约束

**Files:**
- Modify: `src/components/nodes/shared/VideoParamSelector.tsx`
- Test: `tests/components/videoParamSelectorProtocol.test.ts`

**Steps:**
1. 写失败测试，覆盖 2.5 默认显示“自动”、用户仍可选择 4-30 秒、首尾帧只显示 `adaptive`。
2. 增加自动时长按钮与任务模式下的有效比例计算。
3. 切换模型或参考模式时，把失效的旧值收敛到当前能力默认值。
4. 重跑组件定向测试。

### Task 5: 自定义接口一键应用能力与协议

**Files:**
- Modify: `src/components/settings/providerConnection/VideoCapabilityEditor.tsx`
- Modify: `src/components/settings/providerConnection/ProviderModelSection.tsx`
- Modify: `src/components/settings/providerConnection/providerConnectionModels.ts`
- Test: `tests/components/providerConnectionForm.test.tsx`
- Test: `tests/services/seedanceModelCapabilities.test.ts`

**Steps:**
1. 写失败测试，覆盖显式选择型号与协议后同时写入 `videoCapability` 和 `executionProfile`。
2. 在视频能力编辑器增加“Seedance 快速适配”，提供 2.0/2.0 Fast/2.0 Mini/2.5 与火山原生/APIMart 兼容组合。
3. 应用前展示覆盖提示；应用后仍可打开能力和协议编辑器逐项调整。
4. 不对未选择模板的模型做名称推断或配置迁移。

### Task 6: 文档与完整验证

**Files:**
- Modify: `doc/模型与生成模块.md`

**Steps:**
1. 记录能力层与传输层边界、自定义快速适配的显式选择原则及已知中转限制。
2. 运行改动文件定向 ESLint、相关 Vitest、`npm run typecheck`、`npm run test:typecheck`、`git diff --check`。
3. 使用严格 UTF-8 解码检查全部改动文本并扫描常见乱码字符。
4. 检查 `git status --short`，确保不包含既有 `builtinWorkflows` 改动。

## 实施结果（2026-09-21）

- 状态：已完成。Seedance 2.0/2.5 共用官方能力语义，火山直连与 APIMart 保留各自传输覆盖；自定义接口支持显式选择八组“型号 + 协议”快速模板。
- 参数行为：火山 Seedance 2.5 默认提交自动时长 `-1`；首尾帧模式只展示 `adaptive`，视频编辑同时强制 `adaptive` 与自动时长。旧值在模型或参考模式切换后会收敛到当前有效默认值。
- 安全边界：快速适配只由用户手动应用，不按模型名称推断；未知复合 `content` 文档继续走原有人工确认逻辑，未扩大自动导入范围。
- 验证：`npm run typecheck`、`npm run test:typecheck`、改动文件定向 ESLint、`git diff --check` 均通过；全量 `npm run test` 为 344 个文件、4391 项通过。
- 未覆盖：未使用真实火山/APIMart Key 发起付费生成，也未做桌面端人工视觉验收；协议字段与能力边界由本地合同测试覆盖。

# SpeakEasy — AI 英语口语陪练

基于 **React + Node.js** 的 AI 英语口语练习平台。接入腾讯云/DeepSeek 真实 API，支持场景化对话、智能纠错和课后总结。

---

## 演示视频

[![观看演示视频](https://pan.baidu.com/s/1dLXsHkx9cLjUVlWRVbcwTg?pwd=356r，用百度网盘打开)

---

## 功能特性

| 功能 | 说明 |
|------|------|
| **语音识别** | ☁️ 腾讯云 SentenceRecognition（高精度）） |
| **DeepSeek 对话** | 人格化 AI 角色（Sarah/Mike/David），自然口语风格，带对话记忆 |
| **三大场景** | 面试 / 点餐 / 会议，不同角色和对话风格 |
| **智能纠错** | 每轮对话提供英语表达纠错建议（时态、用词、语法） |
| **语音合成** | AI 回复自动朗读（浏览器 SpeechSynthesis） |
| **课后总结** | 对话结束后生成报告：错误分布统计、改进建议、完整历史 |
| **模拟模式** | 无需真实 API Key 即可零成本体验完整流程 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS |
| 后端 | Express + TypeScript + tsx（热重载） |
| ASR 语音识别 | **腾讯云 SentenceRecognition**（首选）/ 七牛云 Dora（备用）/ 浏览器 Web Speech API |
| AI 对话 | **DeepSeek Chat**（首选）/ OpenAI（备用） |
| TTS 语音合成 | **浏览器 SpeechSynthesis**（免费） |

## 架构概览

```
┌─────────────────────────────────────┐
│  客户端 (React + Vite :5173)        │
│                                     │
│  Recorder.tsx   ── 核心组件         │
│  ├── 场景选择 (面试/点餐/会议)       │
│  ├── 双模式录音 (浏览器/腾讯云)      │
│  ├── webm→WAV 格式转换              │
│  ├── 对话历史管理 + 课后总结模态框   │
│  └── 自动 ASR→Chat→TTS 链路         │
│                  │                  │
│        /api/*   │  Vite Proxy       │
└──────────────────┼──────────────────┘
                   │
┌──────────────────┼──────────────────┐
│  服务端 (Express :3002)            │
│                  ▼                  │
│  /api/tencent-asr  → 腾讯云 ASR    │
│  /api/chat         → DeepSeek API  │
│  /api/asr          → 七牛云 (备用)  │
│  /api/tts          → 七牛云 (备用)  │
└─────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **npm** >= 9
- Chrome / Edge（需 MediaRecorder + Web Audio API）

### 1. 安装依赖

```powershell
# 前端
cd D:\SpeakEasy\SpeakEasy-Rewrite\client; npm install

# 后端
cd D:\SpeakEasy\SpeakEasy-Rewrite\server; npm install
```

### 2. 配置环境变量

编辑 `server/.env`：

```bash
# ============================================
# Chat 对话 — DeepSeek（推荐）
# ============================================
# 在 https://platform.deepseek.com/api_keys 获取 Key
AI_PROVIDER=deepseek
OPENAI_API_KEY=sk-your-deepseek-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat

# ============================================
# ASR 语音识别 — 腾讯云
# ============================================
# 在 https://console.cloud.tencent.com/cam/capi 获取
TENCENT_SECRET_ID=your_tencent_secret_id_here
TENCENT_SECRET_KEY=your_tencent_secret_key_here
TENCENT_REGION=ap-guangzhou

# ============================================
# 模拟模式（开发调试用，设为 true 零成本运行）
# ============================================
USE_MOCK_ASR=false     # true=返回固定文字
USE_MOCK_TTS=true      # true=浏览器内置 TTS
USE_MOCK_CHAT=false    # true=返回固定回复

# 端口
PORT=3002
```

> **密钥获取：**
> - DeepSeek: [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)（新用户有免费额度）
> - 腾讯云: [console.cloud.tencent.com/cam/capi](https://console.cloud.tencent.com/cam/capi)

### 3. 启动服务

```powershell
# 终端1 — 后端（必须先启动）
cd D:\SpeakEasy\SpeakEasy-Rewrite\server; npm run dev

# 终端2 — 前端
cd D:\SpeakEasy\SpeakEasy-Rewrite\client; npm run dev
```

### 4. 访问

打开浏览器 → **http://localhost:5173/**

---

## 项目结构

```
SpeakEasy-Rewrite/
├── client/                           # 前端 (Vite + React)
│   ├── src/
│   │   ├── components/
│   │   │   └── Recorder.tsx          # 核心组件（630+ 行）
│   │   │       ├── 双模式 ASR (浏览器 Web Speech / 腾讯云)
│   │   │       ├── webm→WAV 实时转码（用 AudioContext）
│   │   │       ├── 场景选择 UI + 对话历史管理
│   │   │       └── 课后总结模态框（错误统计+建议）
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css                 # Tailwind CSS
│   ├── vite.config.ts                # API 代理 → :3002
│   └── package.json
│
├── server/                           # 后端 (Express + tsx)
│   ├── src/
│   │   ├── index.ts                  # 入口，注册路由
│   │   ├── routes/
│   │   │   ├── tencentAsr.ts         # POST /api/tencent-asr    腾讯云 ASR
│   │   │   ├── chat.ts               # POST /api/chat           AI 对话 (DeepSeek)
│   │   │   ├── asr.ts                # POST /api/asr            七牛云 ASR (备用)
│   │   │   └── tts.ts                # POST /api/tts            七牛云 TTS (备用)
│   │   └── services/
│   │       ├── tencentAsr.ts          # 腾讯云 SDK 封装
│   │       ├── qiniuAsr.ts            # 七牛云 ASR 封装
│   │       └── qiniuTts.ts            # 七牛云 TTS 封装
│   ├── .env                           # 环境变量
│   ├── tsconfig.json
│   └── package.json
│
├── README.md
└── PR_DESCRIPTION.md
```

---

## API 接口

### POST /api/tencent-asr — 语音识别（腾讯云）

上传 WAV/PCM/MP3 音频，返回识别文字。

| 项目 | 值 |
|------|-----|
| **Content-Type** | `multipart/form-data` |
| **字段名** | `audio` |
| **支持格式** | wav / pcm / mp3 / m4a |
| **采样率** | 16000 Hz |
| **引擎** | 16k_en（英语识别） |

**响应：**
```json
{ "success": true, "text": "Hello, how are you doing today?", "requestId": "abc123" }
```

### POST /api/chat — AI 对话（DeepSeek）

| 项目 | 值 |
|------|-----|
| **Content-Type** | `application/json` |

**请求体：**
```json
{
  "text": "我昨天去上学了",
  "scene": "interview",
  "history": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! Nice to meet you." }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `text` | string | 是 | 用户说的文字（中英文混合均可） |
| `scene` | string | 否 | `interview` / `ordering` / `meeting`，默认 `interview` |
| `history` | ChatMessage[] | 否 | 对话历史（最近 10 轮），用于维持上下文记忆 |

**响应：**
```json
{
  "success": true,
  "reply": "Oh, you went to school yesterday! That's great. What subject did you enjoy the most?",
  "correction": "Try: 'I went to school yesterday.' Use past tense 'went'.",
  "scene": "interview"
}
```

### POST /api/asr — 语音识别（七牛云，备用）

与 `/api/tencent-asr` 格式相同，使用七牛云 Dora 短语音听写。

### POST /api/tts — 语音合成（七牛云，备用）

```json
{ "text": "Hello, how are you?" }
```
→ 音频流（audio/mpeg / audio/wav）

### GET /health — 健康检查

```json
{ "status": "ok", "timestamp": "2026-06-06T07:35:35.182Z" }
```

---

## 使用流程

```
1. 选 ASR 模式: ☁️腾讯云识别（高精度） 或 🎤浏览器识别（免费）
2. 选场景: 💼面试 / 🍽️点餐 / 📋会议

3. 点击「开始录音」→ 说英语 → 点击「停止」

4. 自动执行完整链路:
   ┌─ 录音 (webm)
   ├─ webm→WAV 格式转换（AudioContext）
   ├─ ASR 识别（腾讯云 / 浏览器）
   ├─ 显示"你说的是: xxx"
   ├─ Chat 对话（DeepSeek + 历史记忆）
   ├─ 显示 AI 回复 + 纠错建议
   └─ TTS 朗读 AI 回复

5. 继续说话 → 多轮对话...

6. 点击「结束对话」→ 课后总结模态框:
   ├─ 对话轮次统计
   ├─ 错误类型分布 (时态/用词/语法)
   ├─ 针对性改进建议
   └─ 完整对话历史（可滚动）
```

---

## 场景说明

| 场景 | AI 角色 | 人格 | 对话风格 |
|------|---------|------|----------|
| 💼 面试 | **Sarah** — HR 经理 | 专业亲和 | 询问经历、技能、优缺点 |
| 🍽️ 点餐 | **Mike** — 餐厅服务员 | 热情随意 | 推荐菜品、确认细节 |
| 📋 会议 | **David** — 团队主管 | 干练高效 | 同步进度、讨论方案 |

## ASR 模式对比

| | ☁️ 腾讯云识别（默认） | 🎤 浏览器识别 |
|------|----------------------|--------------|
| **费用** | ¥3/千次 | 免费 |
| **准确率** | 高（专业 ASR） | 英文优秀 |
| **延迟** | 中等（上传+解码） | 低（实时流式） |
| **网络依赖** | 需要 | 需要（Google 服务器） |
| **浏览器** | 全部 | Chrome / Edge / Safari |
| **适用** | 需要高精度场景 | 日常练习 |

## 价格估算

| 功能 | 服务 | 单价 | 月成本（100次） |
|------|------|------|---------------|
| 语音识别 | 腾讯云 SentenceRecognition | ¥3/千次 | ~¥0.30 |
| AI 对话 | DeepSeek Chat | ¥1/百万 token | ~¥0.50 |
| 语音合成 | 浏览器 SpeechSynthesis | 免费 | ¥0 |
| **合计** | | | **~¥0.80/月** |

---

## 模拟模式

开发调试时无需任何 API Key，在 [server/.env](file:///d:/SpeakEasy/SpeakEasy-Rewrite/server/.env) 中：

```bash
USE_MOCK_ASR=true    # ASR 返回固定文字 "Hello, how are you doing today?"
USE_MOCK_CHAT=true   # Chat 返回场景化模拟回复
USE_MOCK_TTS=true    # TTS 使用浏览器内置引擎
```

全部 `true` → **零成本体验完整流程**。

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| **录音无反应** | 检查浏览器麦克风权限，用 Chrome/Edge 最新版 |
| **腾讯云识别报"audio data empty"** | 确保前端代码是最新版（已添加 webm→WAV 转码） |
| **Request 500** | 检查后端是否运行、`.env` 密钥是否填写、`USE_MOCK_ASR` 状态 |
| **EADDRINUSE :::3002** | 后端已在运行，无需重复启动 |
| **浏览器识别报 network 错误** | 国内环境可能被墙，切换为「☁️腾讯云识别」模式 |
| **npm error ENOENT** | 确认在子目录执行命令（`cd client` 或 `cd server`），根目录无 package.json |
| **AI 回复牛头不对马嘴** | 检查 System Prompt 版本（最新版已增强，支持中英混合理解+对话记忆） |
| **切换回 OpenAI** | `.env` 中改 `AI_PROVIDER=openai`，填 OpenAI Key 即可 |

---

## 在 WebStorm 中运行

1. **Run → Edit Configurations** → 添加两个 npm 配置：

| 配置名 | package.json | Command | Script |
|--------|-------------|---------|--------|
| `后端` | `server/package.json` | `run` | `dev` |
| `前端` | `client/package.json` | `run` | `dev` |

2. 先启动后端，再启动前端
3. 访问 http://localhost:5173/

---

## License

MIT

import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import asrRouter from './routes/asr.js'
import chatRouter from './routes/chat.js'
import ttsRouter from './routes/tts.js'
import tencentAsrRouter from './routes/tencentAsr.js'

const app = express()
const PORT = parseInt(process.env.PORT || '3002', 10)

// 中间件配置
app.use(cors())
app.use(express.json())

// 注册路由
app.use('/api', asrRouter)           // 七牛云 ASR（备用）
app.use('/api', chatRouter)          // AI 对话
app.use('/api', ttsRouter)           // TTS 语音合成
app.use('/api', tencentAsrRouter)    // 腾讯云 ASR（新）

// 健康检查
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 启动服务
app.listen(PORT, () => {
    console.log(`[Server] SpeakEasy 服务已启动：http://localhost:${PORT}`)
    console.log(`[Server] ASR 模拟模式：${process.env.USE_MOCK_ASR === 'true' ? '开启' : '关闭'}`)
    console.log(`[Server] Chat 模拟模式：${process.env.USE_MOCK_CHAT === 'true' ? '开启' : '关闭'}`)
    console.log(`[Server] TTS 模拟模式：${process.env.USE_MOCK_TTS === 'true' ? '开启' : '关闭'}`)
})

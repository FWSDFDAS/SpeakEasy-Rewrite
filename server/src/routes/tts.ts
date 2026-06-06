import { Router } from 'express'
import { synthesizeSpeech, mockSynthesize } from '../services/qiniuTts.js'

const router = Router()

/**
 * POST /api/tts
 * 接收文字内容，调用七牛云 TTS 合成语音并返回音频流
 *
 * 请求体：JSON { text: string }
 * 响应：音频流（MP3/WAV），Content-Type 为对应 MIME 类型
 */
router.post('/tts', async (req, res) => {
    try {
        const { text } = req.body

        // 校验必填参数
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            res.status(400).json({ success: false, error: '请提供要合成的文字内容（text）' })
            return
        }

        // 文字长度限制
        if (text.length > 500) {
            res.status(400).json({ success: false, error: '合成文字长度不能超过 500 字符' })
            return
        }

        // 判断是否使用模拟模式
        const useMock = process.env.USE_MOCK_ASR === 'true' || process.env.USE_MOCK_TTS === 'true'

        let result
        if (useMock) {
            result = mockSynthesize()
        } else {
            result = await synthesizeSpeech(text.trim())
        }

        if (!result.success || !result.audioBuffer) {
            res.status(500).json({ success: false, error: result.error || '语音合成失败' })
            return
        }

        // 返回音频流
        res.setHeader('Content-Type', result.mimeType || 'audio/mpeg')
        res.setHeader('Content-Length', result.audioBuffer.length)
        res.send(result.audioBuffer)

    } catch (err) {
        console.error('[TTS Error]', err)

        const message =
            err instanceof Error ? err.message : '语音合成服务异常，请稍后重试'

        res.status(500).json({ success: false, error: message })
    }
})

export default router

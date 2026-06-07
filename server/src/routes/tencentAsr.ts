import { Router } from 'express'
import formidable from 'formidable'
import fs from 'fs/promises'
import { recognizeAudio, mockRecognize } from '../services/tencentAsr.js'

const router = Router()

/**
 * POST /api/tencent-asr
 * 接收音频文件，调用腾讯云 ASR 进行语音识别
 *
 * 请求格式：multipart/form-data，字段名为 audio
 * 支持格式：wav（推荐）、webm、mp3 等
 */
router.post('/tencent-asr', async (req, res) => {
    console.log('[TencentASR] 收到请求')
    try {
        // formidable v3: parse() 返回 [fields, files] 数组（tuple）
        const form = formidable({
            maxFileSize: 10 * 1024 * 1024,
            allowEmptyFiles: false,
        })

        const [fields, files] = await form.parse(req)
        console.log('[TencentASR] parse 成功, audio:', files.audio)

        const audioFile = Array.isArray(files.audio) ? files.audio[0] : files.audio
        if (!audioFile) {
            res.json({ success: false, error: '请上传音频文件（字段名：audio）' })
            return
        }

        const audioBuffer = await fs.readFile(audioFile.filepath)
        const filename = audioFile.originalFilename || 'audio.wav'

        console.log(`[TencentASR Route] 收到文件: ${filename}, 大小: ${(audioBuffer.length / 1024).toFixed(1)}KB`)

        const useMock = process.env.USE_MOCK_ASR === 'true'
        let result

        if (useMock) {
            result = mockRecognize()
        } else {
            result = await recognizeAudio(audioBuffer)
        }

        res.json(result)
    } catch (err) {
        console.error('[TencentASR Route Error]', err)
        const message = err instanceof Error ? err.message : '语音识别服务异常'
        res.status(500).json({ success: false, error: message })
    }
})

export default router

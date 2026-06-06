import { Router } from 'express'
import formidable from 'formidable'
import fs from 'fs/promises'
import { recognizeAudio, mockRecognize } from '../services/qiniuAsr.js'

const router = Router()

/**
 * POST /api/asr
 * 接收音频文件，调用七牛云 ASR 并返回识别结果
 *
 * 请求格式：multipart/form-data，字段名为 audio
 * 支持格式：webm（采样率 16kHz，单声道）
 */
router.post('/asr', async (req, res) => {
    try {
        // 使用 formidable 解析 multipart 表单数据
        const form = formidable({
            multiples: false,
            maxFileSize: 10 * 1024 * 1024, // 最大 10MB
            allowEmptyFiles: false,
        })

        const [fields, files] = await new Promise<[formidable.Fields<string>, formidable.Files<string>]>(
            (resolve, reject) => {
                form.parse(req, (err, fields, files) => {
                    if (err) reject(err)
                    else resolve([fields, files])
                })
            }
        )

        // 获取上传的音频文件
        const audioFile = files.audio?.[0]
        if (!audioFile) {
            res.json({ success: false, error: '请上传音频文件（字段名：audio）' })
            return
        }

        // 校验文件格式（仅允许 webm）
        const mimeType = audioFile.mimetype || ''
        if (!mimeType.includes('webm')) {
            res.json({ success: false, error: '不支持的音频格式，请上传 webm 格式的音频文件' })
            return
        }

        // 读取音频文件为 Buffer
        const audioBuffer = await fs.readFile(audioFile.filepath)

        // 判断是否使用模拟模式
        const useMock = process.env.USE_MOCK_ASR === 'true'

        let result
        if (useMock) {
            result = mockRecognize()
        } else {
            result = await recognizeAudio(audioBuffer)
        }

        res.json(result)

    } catch (err) {
        console.error('[ASR Error]', err)

        const message =
            err instanceof Error ? err.message : '语音识别服务异常，请稍后重试'

        res.status(500).json({ success: false, error: message })
    }
})

export default router

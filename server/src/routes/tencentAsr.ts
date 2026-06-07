import { Router } from 'express'
import formidable from 'formidable'
import fs from 'fs/promises'
 feature/final-pr
import { recognizeAudio, mockRecognize } from '../services/tencentAsr.js'
import { tencentRecognizeAudio, mockTencentRecognize } from '../services/tencentAsr.js'
 main

const router = Router()

/**
 * POST /api/tencent-asr
feature/final-pr
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
 * 接收音频文件，调用腾讯云 SentenceRecognition 接口进行语音识别
 *
 * 请求格式：multipart/form-data，字段名为 audio
 * 支持格式：wav、pcm、mp3、m4a（推荐 wav，16kHz 采样率）
 */
router.post('/tencent-asr', async (req, res) => {
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
            },
        )

        // 获取上传的音频文件
        const audioFile = files.audio?.[0]
 main
        if (!audioFile) {
            res.json({ success: false, error: '请上传音频文件（字段名：audio）' })
            return
        }

 feature/final-pr
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
        // 校验文件格式
        const allowedTypes = ['wav', 'pcm', 'mp3', 'm4a', 'speex', 'silk', 'webm', 'ogg', 'flac', 'aac']
        const ext = (audioFile.originalFilename || '').split('.').pop()?.toLowerCase() || ''
        if (!allowedTypes.includes(ext)) {
            res.json({
                success: false,
                error: `不支持的音频格式：${ext}。支持：wav、pcm、mp3、m4a`,
            })
            return
        }

        // 读取音频文件为 Buffer
        const audioBuffer = await fs.readFile(audioFile.filepath)
        const filename = audioFile.originalFilename || 'audio.wav'

        // 判断是否使用模拟模式
        const useMock = process.env.USE_MOCK_ASR === 'true'

        let result
        if (useMock) {
            result = mockTencentRecognize()
        } else {
            result = await tencentRecognizeAudio(audioBuffer, filename)
        }

        res.json(result)

    } catch (err) {
        console.error('[Tencent ASR Error]', err)

        const message =
            err instanceof Error ? err.message : '语音识别服务异常，请稍后重试'

 main
        res.status(500).json({ success: false, error: message })
    }
})

export default router

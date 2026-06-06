import crypto from 'crypto'

// 七牛云 TTS API 配置
const QINIU_TTS_API = 'https://ai.qiniuapi.com/v1/audio/tts'

/**
 * 生成七牛云认证 Token（HMAC-SHA1 签名）
 */
function generateQiniuToken(accessKey: string, secretKey: string, path: string): string {
    const signData = `${path}\n`
    const hmac = crypto.createHmac('sha1', secretKey)
    hmac.update(signData)
    const digest = hmac.digest('base64')
    return `QBox ${accessKey}:${digest}`
}

/** TTS 合成结果接口 */
export interface TtsResult {
    success: boolean
    audioBuffer?: Buffer
    mimeType?: string
    error?: string
}

/**
 * 调用七牛云 TTS API 将文字合成为语音
 * @param text 要合成的文字内容
 */
export async function synthesizeSpeech(text: string): Promise<TtsResult> {
    const accessKey = process.env.QINIU_ACCESS_KEY
    const secretKey = process.env.QINIU_SECRET_KEY

    if (!accessKey || !secretKey || accessKey === 'your_access_key_here') {
        throw new Error('未配置七牛云密钥，请在 server/.env 中设置 QINIU_ACCESS_KEY 和 QINIU_SECRET_KEY')
    }

    const path = '/v1/audio/tts'
    const token = generateQiniuToken(accessKey, secretKey, path)

    try {
        const response = await fetch(QINIU_TTS_API, {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                voice_type: 'default',
                speed: 1.0,
                format: 'mp3',
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`TTS API 请求失败 (${response.status}): ${errorText}`)
        }

        const contentType = response.headers.get('content-type') || 'audio/mpeg'
        const arrayBuffer = await response.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)

        if (buffer.length === 0) {
            return { success: false, error: '语音合成返回空数据' }
        }

        return { success: true, audioBuffer: buffer, mimeType: contentType }
    } catch (err) {
        const message = err instanceof Error ? err.message : '语音合成服务调用失败'
        throw new Error(message)
    }
}

/**
 * 生成一个最小有效 WAV 音频文件（用于模拟模式测试）
 * 参数：8000Hz 采样率，单声道，16bit，约 0.5 秒静音
 */
function generateSilentWav(): Buffer {
    const sampleRate = 8000
    const numChannels = 1
    const bitsPerSample = 16
    const duration = 0.5 // 秒
    const numSamples = Math.floor(sampleRate * duration)
    const dataSize = numSamples * numChannels * (bitsPerSample / 8)
    const fileSize = 36 + dataSize

    const header = Buffer.alloc(44 + dataSize)
    let offset = 0

    // RIFF 头
    header.write('RIFF', offset); offset += 4
    header.writeUInt32LE(fileSize, offset); offset += 4
    header.write('WAVE', offset); offset += 4

    // fmt 子块
    header.write('fmt ', offset); offset += 4
    header.writeUInt32LE(16, offset); offset += 4       // 子块大小
    header.writeUInt16LE(1, offset); offset += 2         // PCM 格式
    header.writeUInt16LE(numChannels, offset); offset += 2
    header.writeUInt32LE(sampleRate, offset); offset += 4
    header.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, offset); offset += 4
    header.writeUInt16LE(numChannels * bitsPerSample / 8, offset); offset += 2
    header.writeUInt16LE(bitsPerSample, offset); offset += 2

    // data 子块
    header.write('data', offset); offset += 4
    header.writeUInt32LE(dataSize, offset); offset += 4
    // 剩余为静音样本（已初始化为 0）

    return header
}

/**
 * 模拟模式：返回一个固定的示例音频（静音 WAV）
 * 用于前端流程测试，无需真实密钥
 */
export function mockSynthesize(): TtsResult {
    return { success: true, audioBuffer: generateSilentWav(), mimeType: 'audio/wav' }
}

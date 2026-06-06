import crypto from 'crypto'

// Qiniu Dora ASR API 配置
const QINIU_ASR_API = 'https://asr.qbox.me/v1/asr'

/**
 * 生成七牛云认证 Token（HMAC-SHA1 签名）
 * @param accessKey 七牛 AccessKey
 * @param secretKey 七牛 SecretKey
 * @param path 请求路径
 */
function generateQiniuToken(accessKey: string, secretKey: string, path: string): string {
    const encodedPath = encodeURIComponent(path)
    const signData = `${path}\n`
    const hmac = crypto.createHmac('sha1', secretKey)
    hmac.update(signData)
    const digest = hmac.digest('base64')
    return `QBox ${accessKey}:${digest}`
}

/** ASR 识别结果接口 */
export interface AsrResult {
    success: boolean
    text?: string
    error?: string
}

/**
 * 调用七牛云 Dora 短语音听写 API 进行语音识别
 * @param audioBuffer 音频文件 Buffer（支持 webm 格式）
 * @returns 识别结果
 */
export async function recognizeAudio(audioBuffer: Buffer): Promise<AsrResult> {
    const accessKey = process.env.QINIU_ACCESS_KEY
    const secretKey = process.env.QINIU_SECRET_KEY

    if (!accessKey || !secretKey || accessKey === 'your_access_key_here') {
        throw new Error('未配置七牛云密钥，请在 server/.env 中设置 QINIU_ACCESS_KEY 和 QINIU_SECRET_KEY')
    }

    // 构建请求路径和签名
    const path = '/v1/asr'
    const token = generateQiniuToken(accessKey, secretKey, path)

    try {
        const response = await fetch(QINIU_ASR_API, {
            method: 'POST',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/octet-stream',
            },
            body: audioBuffer,
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`ASR API 请求失败 (${response.status}): ${errorText}`)
        }

        const data = await response.json()

        // 七牛 ASR 返回格式：{ results: [{ text: "...", confidence: ... }] }
        if (data.results && data.results.length > 0) {
            return { success: true, text: data.results[0].text }
        }

        return { success: false, error: '未能识别出语音内容' }
    } catch (err) {
        const message = err instanceof Error ? err.message : '语音识别服务调用失败'
        throw new Error(message)
    }
}

/**
 * 模拟模式：返回固定的识别文字，用于前端流程测试
 * @returns 模拟的识别结果
 */
export function mockRecognize(): AsrResult {
    return { success: true, text: 'Hello, how are you today?' }
}

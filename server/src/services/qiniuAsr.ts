/**
 * 七牛云 Dora 短语音识别（ASR）服务
 *
 * 支持两种模式：
 *   1. 七牛云 Dora 短语音听写 API — 高精度中英文识别
 *   2. 模拟模式 — 返回固定文字，用于调试
 */

import crypto from 'crypto'

/** ASR 识别结果接口 */
export interface AsrResult {
    success: boolean
    text?: string
    error?: string
}

/**
 * 生成七牛云认证 Token（HMAC-SHA1 签名）
 * Qiniu 格式：QBox <accessKey>:<sign>
 */
function generateQiniuToken(accessKey: string, secretKey: string, path: string, body?: Buffer): string {
    // 签名数据：path + "\n"
    // 如果有 body，则：path + "\n" + body 的 base64
    const signStr = body
        ? `${path}\n${body.toString('base64')}`
        : `${path}\n`

    const hmac = crypto.createHmac('sha1', secretKey)
    hmac.update(signStr)
    const digest = hmac.digest('base64')
    return `QBox ${accessKey}:${digest}`
}

/**
 * 调用七牛云 Dora 短语音听写 API 进行语音识别
 * 支持 webm/mp3/wav/m4a 等格式，自动识别中英文混合
 *
 * @param audioBuffer 音频文件 Buffer
 * @param filename 文件名（用于判断格式）
 * @returns 识别结果
 */
export async function recognizeAudio(audioBuffer: Buffer, filename: string = 'audio.webm'): Promise<AsrResult> {
    const accessKey = process.env.QINIU_ACCESS_KEY
    const secretKey = process.env.QINIU_SECRET_KEY

    if (!accessKey || !secretKey || accessKey === 'your_access_key_here') {
        throw new Error('未配置七牛云密钥，请在 server/.env 中设置 QINIU_ACCESS_KEY 和 QINIU_SECRET_KEY')
    }

    // 判断音频格式，ASR 对 webm 支持有限，转为 PCM 格式建议
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (ext === 'webm') {
        console.warn('[Qiniu ASR] webm 格式可能不被完美支持，建议使用 wav 或 mp3')
    }

    // 七牛云 Dora 短语音听写 API 端点
    const apiPath = '/v1/asr'
    const apiUrl = 'https://asr.qiniuapi.com/v1/asr'

    // 构建 multipart/form-data
    const boundary = 'SpeakEasyBoundary' + Math.random().toString(36).slice(2)
    const mimeType = getMimeType(filename)
    const parts: Buffer[] = []

    // 字段名使用 "file"
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
        'utf-8'
    ))
    parts.push(audioBuffer)
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'))

    const body = Buffer.concat(parts)

    // 生成 token：对路径签名
    const token = generateQiniuToken(accessKey, secretKey, apiPath)

    console.log(`[Qiniu ASR] 发送请求到 ${apiUrl}, 音频大小: ${(audioBuffer.length / 1024).toFixed(1)}KB`)

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            Authorization: token,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
    })

    const responseText = await response.text()
    console.log(`[Qiniu ASR] 响应状态: ${response.status}, 内容: ${responseText.substring(0, 500)}`)

    if (!response.ok) {
        throw new Error(`七牛云 ASR 请求失败 (${response.status}): ${responseText.substring(0, 200)}`)
    }

    try {
        const data = JSON.parse(responseText)

        // Dora ASR 返回格式：{ results: [{ text: "...", confidence: ... }] }
        // 也可能返回：{ result: { text: "..." } } 或直接 { text: "..." }
        let text = ''

        if (data.results && Array.isArray(data.results) && data.results.length > 0) {
            text = data.results[0].text || ''
        } else if (data.result && typeof data.result === 'object') {
            text = data.result.text || data.result.speech || ''
        } else if (typeof data.text === 'string') {
            text = data.text
        } else if (typeof data.speech === 'string') {
            text = data.speech
        }

        if (text && text.trim()) {
            console.log(`[Qiniu ASR] 识别成功: "${text.trim()}"`)
            return { success: true, text: text.trim() }
        }

        console.warn(`[Qiniu ASR] 未能解析出识别文字，原始响应:`, responseText.substring(0, 300))
        return { success: false, error: `未能识别出语音内容：${responseText.substring(0, 100)}` }

    } catch (parseErr) {
        console.error(`[Qiniu ASR] JSON 解析失败:`, parseErr)
        return { success: false, error: `识别结果解析失败：${responseText.substring(0, 100)}` }
    }
}

/**
 * 根据文件扩展名推断 MIME 类型
 */
function getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const mimeMap: Record<string, string> = {
        webm: 'audio/webm',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
    }
    return mimeMap[ext] || 'audio/webm'
}

/**
 * 模拟模式：返回固定的识别文字，用于前端流程测试
 */
export function mockRecognize(): AsrResult {
    return { success: true, text: 'Hello, how are you today?' }
}

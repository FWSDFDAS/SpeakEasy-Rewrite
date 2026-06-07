/**
 * 腾讯云语音识别（ASR）服务
 *
 * 使用腾讯云 SentenceRecognition 接口进行短语音识别
 * 引擎模型：16k_en（英语识别）
 */

import tencentcloud from 'tencentcloud-sdk-nodejs'

const AsrClient = tencentcloud.asr.v20190614.Client

/** ASR 识别结果接口 */
export interface AsrResult {
    success: boolean
    text?: string
    error?: string
}

/**
 * 创建腾讯云 ASR 客户端实例
 */
function createClient(): InstanceType<typeof AsrClient> {
    const secretId = process.env.TENCENT_SECRET_ID
    const secretKey = process.env.TENCENT_SECRET_KEY

    if (!secretId || !secretKey) {
        throw new Error('未配置腾讯云密钥，请在 server/.env 中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY')
    }

    const clientConfig = {
        credential: { secretId, secretKey },
        region: 'ap-guangzhou',
        profile: {
            httpProfile: { endpoint: 'asr.tencentcloudapi.com' },
        },
    }

    return new AsrClient(clientConfig)
}

/**
 * 调用腾讯云 SentenceRecognition 进行语音识别
 * 支持 WAV 格式音频（16kHz 采样率）
 *
 * @param audioBuffer 音频文件 Buffer（WAV 格式）
 * @returns 识别结果
 */
export async function recognizeAudio(audioBuffer: Buffer): Promise<AsrResult> {
    try {
        const client = createClient()

        console.log(`[Tencent ASR] 发送请求，音频大小: ${(audioBuffer.length / 1024).toFixed(1)}KB`)

        const params = {
            EngSerViceType: '16k_en',
            SourceType: 1,
            VoiceFormat: 'wav',
            Data: audioBuffer.toString('base64'),
            DataLen: audioBuffer.length,
        }

        const result = await client.SentenceRecognition(params)

        // 腾讯云返回格式：{ Response: { Result: "识别文字" } }
        const text = result.Result

        if (text && text.trim()) {
            console.log(`[Tencent ASR] 识别成功: "${text.trim()}"`)
            return { success: true, text: text.trim() }
        }

        return { success: false, error: '未能识别出语音内容' }
    } catch (err: any) {
        console.error('[Tencent ASR Error]', err)
        const message = err?.message || String(err)
        return { success: false, error: `腾讯云语音识别失败：${message}` }
    }
}

/**
 * 模拟模式：返回固定的识别文字，用于调试
 */
export function mockRecognize(): AsrResult {
    return { success: true, text: 'Hello, how are you today?' }
}

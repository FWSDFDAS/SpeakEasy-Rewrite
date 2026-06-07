/**
 feature/final-pr
 * 腾讯云语音识别（ASR）服务
 *
 * 使用腾讯云 SentenceRecognition 接口进行短语音识别
 * 引擎模型：16k_en（英语识别）
 */

import tencentcloud from 'tencentcloud-sdk-nodejs'

 * 腾讯云 ASR 语音识别服务
 *
 * 调用腾讯云 SentenceRecognition 接口进行短语音识别
 * SDK 文档：https://cloud.tencent.com/document/product/1093/35646
 */

import * as tencentcloud from 'tencentcloud-sdk-nodejs'
 main

const AsrClient = tencentcloud.asr.v20190614.Client

/** ASR 识别结果接口 */
 feature/final-pr
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

export interface TencentAsrResult {
    success: boolean
    text?: string
    error?: string
    requestId?: string
}

/**
 * 调用腾讯云 SentenceRecognition 接口
 *
 * @param audioBuffer  音频文件 Buffer
 * @param filename     文件名（用于推断格式）
 * @returns 识别结果
 */
export async function tencentRecognizeAudio(
    audioBuffer: Buffer,
    filename: string = 'audio.wav',
): Promise<TencentAsrResult> {
    const secretId = process.env.TENCENT_SECRET_ID
    const secretKey = process.env.TENCENT_SECRET_KEY
    const region = process.env.TENCENT_REGION || 'ap-guangzhou'

    if (!secretId || !secretKey || secretId === 'your_tencent_secret_id_here') {
        throw new Error('未配置腾讯云密钥，请在 server/.env 中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY')
    }

    // 根据文件扩展名确定音频格式（腾讯云支持的格式：wav、pcm、mp3、m4a、speex、silk）
    const voiceFormat = getTencentVoiceFormat(filename)
    const ext = filename.split('.').pop()?.toLowerCase() || ''

    console.log(`[Tencent ASR] 音频格式: ${voiceFormat}, 大小: ${(audioBuffer.length / 1024).toFixed(1)}KB`)

    // 实例化客户端
    const client = new AsrClient({
        credential: { secretId, secretKey },
        region,
        profile: {
            httpProfile: { endpoint: 'asr.tencentcloudapi.com' },
        },
    })

    const base64Data = audioBuffer.toString('base64')

    // SentenceRecognition 参数
    // 文档：https://cloud.tencent.com/document/api/1093/35646
    const params = {
        // 引擎模型类型
        // 16k_zh：中文通用（推荐，中英文混合识别）
        // 16k_en：英文通用
        // 8k_zh：电话中文
        EngSerViceType: '16k_en',   // 英语识别
        // 子服务类型：2 = 短语音识别
        SubServiceType: 2,
        // 音频数据来源：1 = 音频数据(base64)，0 = 音频 URL
        SourceType: 1,
        // 音频编码格式
        VoiceFormat: voiceFormat,
        // 音频数据（Base64），Data 和 Url 二选一
        Data: base64Data,
        // 数据长度（原始字节数，非 Base64 后的长度）
        DataLen: audioBuffer.length,
        // 是否过滤脏词 0=不过滤 1=过滤 2=替换为*
        FilterDirty: 0,
        // 是否过滤语气词 0=不过滤 1=过滤 2=过滤并转大写
        FilterModal: 1,
        // 是否过滤标点 0=不过滤 1=过滤
        FilterPunc: 0,
    }

    try {
        console.log(`[Tencent ASR] 发送 SentenceRecognition 请求...`)

        const response = await client.SentenceRecognition(params)

        console.log(`[Tencent ASR] 响应:`, JSON.stringify(response, null, 2).substring(0, 500))

        if (response.Result) {
            const text = response.Result
            console.log(`[Tencent ASR] 识别成功: "${text}"`)
            return {
                success: true,
                text,
                requestId: response.RequestId,
            }
        }

        // 无结果（SDK 的错误通常通过 throw 抛出，不会走到这里）
        console.warn(`[Tencent ASR] 返回结果为空`)
        return { success: false, error: '未能识别出语音内容', requestId: response.RequestId }

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '腾讯云语音识别服务调用失败'
        console.error('[Tencent ASR Error]', message)

        // 尝试解析腾讯云 SDK 抛出的详细错误
        if (err && typeof err === 'object' && 'code' in err) {
            return { success: false, error: `${(err as Record<string, string>).code}: ${message}` }
        }

        throw new Error(message)
    }
}

/**
 * 根据文件扩展名映射腾讯云支持的音频格式
 */
function getTencentVoiceFormat(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const formatMap: Record<string, string> = {
        wav: 'wav',
        pcm: 'pcm',
        mp3: 'mp3',
        m4a: 'm4a',
        speex: 'speex',
        silk: 'silk',
        aac: 'm4a',    // AAC → m4a
        webm: 'mp3',    // webm 腾讯云不支持，降级为 mp3（可能不准）
        ogg: 'mp3',
        flac: 'mp3',
    }
    return formatMap[ext] || 'wav'
}

/**
 * 模拟模式：返回固定文字供调试
 */
export function mockTencentRecognize(): TencentAsrResult {
    return { success: true, text: 'Hello, how are you doing today?', requestId: 'mock-request-id' }
 main
}

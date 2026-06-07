import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'

type RecordingStatus = 'idle' | 'recording' | 'stopped'

/** 场景类型 */
type SceneType = 'interview' | 'ordering' | 'meeting'

/** ASR 模式：腾讯云 / 浏览器内置（Web Speech API） */
type AsrMode = 'tencent' | 'browser'

/**
 * 往 DataView 中写入字符串（WAV header 编码用）
 */
function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i))
    }
}

/** 场景配置 */
const SCENES: { key: SceneType; label: string; icon: string }[] = [
    { key: 'interview', label: '面试', icon: '💼' },
    { key: 'ordering', label: '点餐', icon: '🍽️' },
    { key: 'meeting', label: '会议', icon: '📋' },
]

/** 单轮对话记录 */
interface ConversationTurn {
    userText: string
    aiReply: string
    correction: string
}

/** 错误类型统计 */
interface ErrorStats {
    tense: number      // 时态错误
    vocabulary: number // 用词错误
    grammar: number    // 语法错误
    other: number      // 其他
}

/** ASR 接口返回类型 */
interface AsrResponse {
    success: boolean
    text?: string
    error?: string
}

/** Chat 接口返回类型 */
interface ChatResponse {
    success: boolean
    reply?: string
    correction?: string
    scene?: string
    error?: string
}

export default function Recorder() {
    const [status, setStatus] = useState<RecordingStatus>('idle')
    const [duration, setDuration] = useState(0)
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)

    // 场景状态（默认"面试"）
    const [currentScene, setCurrentScene] = useState<SceneType>('interview')

    // ASR 模式切换：tencent=腾讯云 SentenceRecognition, browser=浏览器Web Speech API（免费）
    const [asrMode, setAsrMode] = useState<AsrMode>('tencent')

    // ASR 相关状态
    const [asrText, setAsrText] = useState<string | null>(null)
    const [isRecognizing, setIsRecognizing] = useState(false)
    const [asrError, setAsrError] = useState<string | null>(null)

    // Chat 相关状态
    const [chatReply, setChatReply] = useState<string | null>(null)
    const [chatCorrection, setChatCorrection] = useState<string | null>(null)
    const [isChatLoading, setIsChatLoading] = useState(false)

    // AI 对话历史（用于维持上下文记忆，每轮追加）
    const [chatHistory, setChatHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])

    // 课后总结相关状态
    const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([])
    const [showSummary, setShowSummary] = useState(false)

    // 浏览器 ASR 相关 Ref
    const speechRecognitionRef = useRef<SpeechRecognition | null>(null)

    // MediaRecorder 相关 Ref（腾讯云 ASR 模式使用）
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    /**
     * 清理所有资源（MediaRecorder + 语音识别）
     */
    const cleanup = useCallback(() => {
        // 清理 MediaRecorder
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop())
            streamRef.current = null
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        mediaRecorderRef.current = null

        // 清理语音识别
        if (speechRecognitionRef.current) {
            try { speechRecognitionRef.current.stop() } catch { /* ignore */ }
            speechRecognitionRef.current = null
        }
    }, [])

    // 组件卸载时清理
    useEffect(() => {
        return () => cleanup()
    }, [cleanup])

    /**
     * 根据纠错文本推断错误类型（简单关键词匹配）
     */
    const classifyErrorType = useCallback((correction: string): keyof ErrorStats => {
        const lower = correction.toLowerCase()
        if (/tense|past|present|future|verb/.test(lower)) return 'tense'
        if (/word|vocabulary|choose|use\s+\w+/.test(lower)) return 'vocabulary'
        if (/grammar|sentence|structure|article|preposition/.test(lower)) return 'grammar'
        return 'other'
    }, [])

    /** 从对话记录生成错误统计 */
    const generateErrorStats = useCallback((): ErrorStats => {
        const stats: ErrorStats = { tense: 0, vocabulary: 0, grammar: 0, other: 0 }
        conversationHistory.forEach((turn) => {
            const type = classifyErrorType(turn.correction)
            stats[type]++
        })
        return stats
    }, [conversationHistory, classifyErrorType])

    /** 根据对话情况生成改进建议 */
    const generateSuggestion = useCallback((): string => {
        const stats = generateErrorStats()
        const totalErrors = stats.tense + stats.vocabulary + stats.grammar + stats.other

        if (totalErrors === 0) return '表现很棒！继续保持，尝试使用更复杂的句式和词汇来提升表达丰富度。'
        if (stats.tense >= stats.vocabulary && stats.tense >= stats.grammar)
            return '注意动词时态的一致性，说话前先想清楚是描述过去、现在还是将来。'
        if (stats.vocabulary >= stats.tense && stats.vocabulary >= stats.grammar)
            return '多积累场景相关的专业词汇，可以提前准备该场景的常用表达。'
        if (stats.grammar > 0)
            return '注意句子结构完整性，主谓一致和冠词使用是常见易错点。'
        return '整体不错！建议多听多说，模仿母语者的语调和表达方式。'
    }, [generateErrorStats])

    /** 错误类型中文标签映射 */
    const ERROR_LABELS: Record<keyof ErrorStats, string> = {
        tense: '时态',
        vocabulary: '用词',
        grammar: '语法',
        other: '其他',
    }

    /**
     * 调用后端 /api/chat 获取 AI 回复和纠错信息
     * 发送对话历史让 AI 有上下文记忆（不再每轮独立回复）
     */
    const sendToChat = useCallback(async (text: string, scene: SceneType) => {
        setIsChatLoading(true)
        setChatReply(null)
        setChatCorrection(null)

        try {
            // 发送当前文字 + 对话历史（让 AI 记住之前聊了什么）
            const response = await axios.post<ChatResponse>('/api/chat', { text, scene, history: chatHistory })
            const data = response.data

            if (data.success && data.reply) {
                setChatReply(data.reply)
                const corr = data.correction || ''
                setChatCorrection(corr || null)

                // 将用户消息和 AI 回复追加到对话历史（供下一轮使用）
                setChatHistory((prev) => [
                    ...prev,
                    { role: 'user', content: text },
                    { role: 'assistant', content: data.reply! },
                ])

                // 同时加入课后总结记录
                setConversationHistory((prev) => [
                    ...prev,
                    { userText: text, aiReply: data.reply!, correction: corr },
                ])
            } else {
                setChatReply(data.error || 'AI 对话失败，请重试')
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : '对话服务连接失败'
            setChatReply(`对话异常：${message}`)
        } finally {
            setIsChatLoading(false)
        }
    }, [chatHistory])

    // ========== 音频格式转换（webm → WAV）==========

    /**
     * 将 AudioBuffer 编码为 WAV 格式的 ArrayBuffer
     * WAV 格式：16kHz, 16bit PCM, 单声道 — 腾讯云 ASR 最佳参数
     */
    const audioBufferToWav = useCallback((buffer: AudioBuffer): ArrayBuffer => {
        const numChannels = buffer.numberOfChannels
        const sampleRate = buffer.sampleRate
        const bitsPerSample = 16
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
        const blockAlign = numChannels * (bitsPerSample / 8)
        const dataLength = buffer.length * blockAlign
        const headerLength = 44
        const totalLength = headerLength + dataLength

        const wav = new ArrayBuffer(totalLength)
        const view = new DataView(wav)

        // RIFF header
        writeString(view, 0, 'RIFF')
        view.setUint32(4, totalLength - 8, true)
        writeString(view, 8, 'WAVE')
        // fmt chunk
        writeString(view, 12, 'fmt ')
        view.setUint32(16, 16, true)           // chunk size
        view.setUint16(20, 1, true)            // PCM format
        view.setUint16(22, numChannels, true)
        view.setUint32(24, sampleRate, true)
        view.setUint32(28, byteRate, true)
        view.setUint16(32, blockAlign, true)
        view.setUint16(34, bitsPerSample, true)
        // data chunk
        writeString(view, 36, 'data')
        view.setUint32(40, dataLength, true)

        // Write PCM samples (interleaved)
        let offset = 44
        for (let i = 0; i < buffer.length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
                const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
                view.setInt16(offset, intSample, true)
                offset += 2
            }
        }

        return wav
    }, [])

    /**
     * 将 webm/opus 音频 Blob 转换为 WAV 格式（腾讯云 ASR 需要 WAV）
     */
    const convertWebmToWav = useCallback(async (webmBlob: Blob): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            try {
                const audioContext = new AudioContext()
                const reader = new FileReader()

                reader.onload = async () => {
                    try {
                        const arrayBuffer = reader.result as ArrayBuffer
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
                        const wavBuffer = audioBufferToWav(audioBuffer)
                        const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })
                        audioContext.close()
                        resolve(wavBlob)
                    } catch (err) {
                        audioContext.close()
                        reject(err)
                    }
                }

                reader.onerror = () => {
                    audioContext.close()
                    reject(new Error('音频文件读取失败'))
                }

                reader.readAsArrayBuffer(webmBlob)
            } catch (err) {
                reject(err)
            }
        })
    }, [audioBufferToWav])

    // ========== Tencent ASR 模式（录音 → 格式转换 → 上传 → 识别）==========

    /**
     * Tencent 模式：调用后端 /api/tencent-asr 进行语音识别，成功后自动调用 Chat
     */
    const sendToAsr = useCallback(async (blob: Blob) => {
        setIsRecognizing(true)
        setAsrError(null)
        setAsrText(null)
        setChatReply(null)
        setChatCorrection(null)

        try {
            // 关键：将 webm 转换为 WAV 格式（腾讯云 ASR 需要）
            console.log('[Recorder] 正在将 webm 转换为 WAV 格式...')
            const wavBlob = await convertWebmToWav(blob)
            console.log(`[Recorder] 转换完成：${(wavBlob.size / 1024).toFixed(1)} KB WAV`)

            const formData = new FormData()
            formData.append('audio', wavBlob, 'recording.wav')

            const response = await axios.post<AsrResponse>(
                '/api/tencent-asr',
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' } }
            )

            const data = response.data
            if (data.success && data.text) {
                setAsrText(data.text)
                sendToChat(data.text, currentScene)
            } else {
                setAsrError(data.error || '语音识别失败，请重试')
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : '语音识别服务连接失败'
            setAsrError(message)
        } finally {
            setIsRecognizing(false)
        }
    }, [currentScene, sendToChat])

    // ========== Browser ASR 模式（新增：浏览器 Web Speech API 实时识别）==========

    /**
     * Browser 模式：使用浏览器内置 Web Speech API 进行实时语音识别
     * 无需后端、无需付费，但依赖网络且仅 Chrome/Edge/Safari 支持较好
     */
    const startBrowserAsr = useCallback(() => {
        const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition
        if (!SpeechRecognition) {
            setError('您的浏览器不支持 Web Speech API，请改用"腾讯云识别"模式或使用 Chrome/Edge 浏览器')
            return false
        }

        const recognition = new SpeechRecognition()
        recognition.lang = 'en-US'
        recognition.interimResults = true
        recognition.continuous = false
        recognition.maxAlternatives = 1

        recognition.onstart = () => {
            setIsRecognizing(true)
            setAsrText(null)
            setAsrError(null)
            setChatReply(null)
            setChatCorrection(null)
        }

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            const lastResult = event.results[event.results.length - 1]
            if (lastResult.isFinal && lastResult[0]) {
                const text = lastResult[0].transcript.trim()
                if (text) {
                    setAsrText(text)
                    sendToChat(text, currentScene)
                }
            }
        }

        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error === 'not-allowed') {
                setError('请允许麦克风权限以使用语音识别功能')
            } else if (event.error !== 'no-speech') {
                setAsrError(`语音识别出错：${event.error}`)
            }
        }

        recognition.onend = () => {
            setIsRecognizing(false)
            setStatus('stopped')
            cleanup()
        }

        speechRecognitionRef.current = recognition
        recognition.start()
        return true
    }, [cleanup, currentScene, sendToChat])

    // ========== 录音控制（根据 asrMode 选择不同模式）==========

    // 开始录音/识别
    const startRecording = useCallback(async () => {
        // 先清理之前的残留状态（防止计时器泄漏）
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
        cleanup()

        setError(null)
        setAudioBlob(null)
        setIsPlaying(false)
        setAsrText(null)
        setAsrError(null)
        setChatReply(null)
        setChatCorrection(null)
        chunksRef.current = []
        setDuration(0)  // 重置为 0

        if (asrMode === 'browser') {
            // 浏览器 ASR 模式：直接启动 Web Speech API
            const ok = startBrowserAsr()
            if (!ok) return
            setStatus('recording')
            timerRef.current = setInterval(() => {
                setDuration((prev) => prev + 1)
            }, 1000)
            return
        }

        // 腾讯云 ASR 模式：使用 MediaRecorder 录音
        try {
            if (typeof MediaRecorder === 'undefined') {
                throw new Error('您的浏览器不支持录音功能，请使用 Chrome、Firefox 或 Edge 浏览器')
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            streamRef.current = stream

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : MediaRecorder.isTypeSupported('audio/webm')
                    ? 'audio/webm'
                    : ''

            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            mediaRecorderRef.current = mediaRecorder

            mediaRecorder.ondataavailable = (e: BlobEvent) => {
                if (e.data.size > 0) chunksRef.current.push(e.data)
            }

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
                setAudioBlob(blob)
                setStatus('stopped')
                cleanup()
                sendToAsr(blob)
            }

            mediaRecorder.start()
            setStatus('recording')

            timerRef.current = setInterval(() => {
                setDuration((prev) => prev + 1)
            }, 1000)
        } catch (err) {
            if (err instanceof DOMException && err.name === 'NotAllowedError') {
                setError('请允许访问麦克风权限以使用录音功能')
            } else if (err instanceof DOMException && err.name === 'NotFoundError') {
                setError('未检测到麦克风设备，请连接麦克风后重试')
            } else {
                setError(err instanceof Error ? err.message : '录音启动失败，请重试')
            }
            cleanup()
        }
    }, [asrMode, startBrowserAsr, cleanup, sendToAsr])

    // 停止录音/识别
    const stopRecording = useCallback(() => {
        if (asrMode === 'browser') {
            // 停止浏览器语音识别
            if (speechRecognitionRef.current) {
                try { speechRecognitionRef.current.stop() } catch { /* ignore */ }
            }
        } else {
            // 停止 MediaRecorder
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop()
            }
        }
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
    }, [asrMode])

    // 播放录音（仅 tencent 模式有音频文件）
    const playRecording = useCallback(() => {
        if (!audioBlob) return

        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        audioRef.current = audio

        audio.onplay = () => setIsPlaying(true)
        audio.onended = () => {
            setIsPlaying(false)
            URL.revokeObjectURL(audioUrl)
        }
        audio.onerror = () => {
            setIsPlaying(false)
            setError('音频播放失败')
            URL.revokeObjectURL(audioUrl)
        }

        audio.play()
    }, [audioBlob])

    // 结束对话 → 打开总结模态框
    const handleEndSession = useCallback(() => {
        setShowSummary(true)
    }, [])

    // 开始新对话 → 重置所有状态（包括 AI 对话记忆）
    const handleNewSession = useCallback(() => {
        setShowSummary(false)
        setConversationHistory([])
        setChatHistory([])  // 重置 AI 对话记忆
        setAsrText(null)
        setAsrError(null)
        setChatReply(null)
        setChatCorrection(null)
        setAudioBlob(null)
        setStatus('idle')
        setDuration(0)
        setError(null)
    }, [])

    // 格式化时长显示
    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    // 计算总结数据
    const errorStats = generateErrorStats()
    const suggestion = generateSuggestion()
    const totalTurns = conversationHistory.length

    // 检查浏览器是否支持 Web Speech API
    const isBrowserAsrSupported = typeof window !== 'undefined' &&
        !!(window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition)

    return (
        <div className="flex flex-col items-center gap-6 p-8 bg-white rounded-2xl shadow-lg w-full max-w-md">
            {/* 标题 */}
            <h1 className="text-2xl font-bold text-gray-800">AI 英语口语陪练</h1>

            {/* ASR 模式选择 */}
            <div className="w-full">
                <p className="text-xs text-gray-400 mb-1.5 text-center">语音识别模式</p>
                <div className="flex items-center justify-center gap-2">
                    <button
                        onClick={() => setAsrMode('browser')}
                        disabled={status === 'recording'}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border ${asrMode === 'browser'
                            ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                            : !isBrowserAsrSupported
                                ? 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300 hover:text-emerald-600'
                            } ${status === 'recording' ? 'opacity-50' : ''}`}
                    >
                        🎤 浏览器识别（免费）
                    </button>
                    <button
                        onClick={() => setAsrMode('tencent')}
                        disabled={status === 'recording'}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border ${asrMode === 'tencent'
                            ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
                            } ${status === 'recording' ? 'opacity-50' : ''}`}
                    >
                        ☁️ 腾讯云识别
                    </button>
                </div>
                {!isBrowserAsrSupported && (
                    <p className="text-[10px] text-orange-400 mt-1 text-center">当前浏览器不支持浏览器识别模式</p>
                )}
            </div>

            {/* 场景选择区域 */}
            <div className="w-full">
                <p className="text-sm text-gray-500 mb-2 text-center">
                    当前场景：<span className="font-semibold text-indigo-600">{SCENES.find(s => s.key === currentScene)?.label}</span>
                </p>
                <div className="flex items-center justify-center gap-3">
                    {SCENES.map((scene) => (
                        <button
                            key={scene.key}
                            onClick={() => setCurrentScene(scene.key)}
                            disabled={status === 'recording'}
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer border ${status === 'recording' ? 'opacity-50 cursor-not-allowed' : ''} ${currentScene === scene.key
                                ? 'bg-indigo-500 text-white border-indigo-500 shadow-md scale-105'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50 active:scale-95'
                                }`}
                        >
                            <span className="mr-1">{scene.icon}</span>
                            {scene.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 时长显示 */}
            <div className="text-5xl font-mono font-bold text-indigo-600 tabular-nums">
                {formatDuration(duration)}
            </div>

            {/* 录音状态指示 */}
            {status === 'recording' && (
                <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                    <span className="text-red-500 font-medium">
                        {asrMode === 'browser' ? '正在聆听...' : '正在录音...'}
                    </span>
                </div>
            )}

            {/* 对话轮次提示 */}
            {totalTurns > 0 && !showSummary && (
                <p className="text-xs text-gray-400">已进行 {totalTurns} 轮对话</p>
            )}

            {/* 错误提示 */}
            {error && (
                <div className="w-full p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm text-center">
                    {error}
                </div>
            )}

            {/* 操作按钮组 */}
            <div className="flex items-center gap-4">
                <button
                    onClick={startRecording}
                    disabled={status === 'recording'}
                    className={`px-6 py-2.5 rounded-xl font-medium text-white transition-all duration-200 cursor-pointer ${status === 'recording'
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-green-500 hover:bg-green-600 active:scale-95 shadow-md hover:shadow-lg'
                        }`}
                >
                    开始{asrMode === 'browser' ? '说话' : '录音'}
                </button>

                <button
                    onClick={stopRecording}
                    disabled={status !== 'recording'}
                    className={`px-6 py-2.5 rounded-xl font-medium text-white transition-all duration-200 cursor-pointer ${status !== 'recording'
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-red-500 hover:bg-red-600 active:scale-95 shadow-md hover:shadow-lg'
                        }`}
                >
                    停止
                </button>

                {/* 结束对话按钮 */}
                {totalTurns > 0 && !showSummary && (
                    <button
                        onClick={handleEndSession}
                        disabled={status === 'recording'}
                        className="px-6 py-2.5 rounded-xl font-medium bg-gray-700 text-white hover:bg-gray-800 active:scale-95 shadow-md transition-all duration-200 cursor-pointer"
                    >
                        结束对话
                    </button>
                )}
            </div>

            {/* 播放录音按钮（仅 tencent 模式有录音文件） */}
            {asrMode === 'tencent' && (
                <button
                    onClick={playRecording}
                    disabled={!audioBlob || isPlaying}
                    className={`px-8 py-2.5 rounded-xl font-medium transition-all duration-200 cursor-pointer ${!audioBlob || isPlaying
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-indigo-500 text-white hover:bg-indigo-600 active:scale-95 shadow-md hover:shadow-lg'
                        }`}
                >
                    {isPlaying ? '播放中...' : '播放录音'}
                </button>
            )}

            {/* 结果区域：ASR + Chat */}
            {(isRecognizing || isChatLoading || asrText || asrError || chatReply || chatCorrection) && !showSummary && (
                <div className="w-full border-t border-gray-100 pt-4 flex flex-col items-center gap-3">
                    {/* 识别中 */}
                    {isRecognizing && (
                        <div className="flex items-center gap-2 text-indigo-500">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            <span className="text-sm font-medium">
                                {asrMode === 'browser' ? '正在识别...' : '语音识别中...'}
                            </span>
                        </div>
                    )}

                    {/* AI 思考中 */}
                    {isChatLoading && !isRecognizing && (
                        <div className="flex items-center gap-2 text-purple-500">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            <span className="text-sm font-medium">AI 正在思考回复...</span>
                        </div>
                    )}

                    {/* ASR 识别结果 */}
                    {asrText && (
                        <div className="w-full p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                            <p className="text-xs text-indigo-400 mb-1">你说的是</p>
                            <p className="text-indigo-700 font-medium text-base">{asrText}</p>
                        </div>
                    )}

                    {/* AI 回复 */}
                    {chatReply && !isChatLoading && (
                        <div className="w-full p-4 bg-purple-50 border border-purple-200 rounded-xl">
                            <p className="text-xs text-purple-400 mb-1">AI 回复</p>
                            <p className="text-purple-700 font-medium text-base">{chatReply}</p>
                        </div>
                    )}

                    {/* 纠错建议 */}
                    {chatCorrection && !isChatLoading && (
                        <div className="w-full p-3 bg-teal-50 border border-teal-200 rounded-lg">
                            <p className="text-xs text-teal-500 mb-1">纠错建议</p>
                            <p className="text-teal-700 text-sm">{chatCorrection}</p>
                        </div>
                    )}

                    {/* 错误提示 */}
                    {asrError && (
                        <div className="w-full p-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-600 text-sm text-center">
                            {asrError}
                        </div>
                    )}
                </div>
            )}

            {/* ===== 课后总结模态框 ===== */}
            {showSummary && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 flex flex-col gap-5">
                        {/* 模态框标题栏 */}
                        <div className="flex items-center justify-between border-b pb-3">
                            <h2 className="text-xl font-bold text-gray-800">课后总结</h2>
                            <button
                                onClick={handleNewSession}
                                className="px-4 py-1.5 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 transition-colors cursor-pointer"
                            >
                                新建对话
                            </button>
                        </div>

                        {/* 统计概览 */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-indigo-50 rounded-xl p-4 text-center">
                                <p className="text-3xl font-bold text-indigo-600">{totalTurns}</p>
                                <p className="text-xs text-indigo-400 mt-1">对话轮次</p>
                            </div>
                            <div className="bg-purple-50 rounded-xl p-4 text-center">
                                <p className="text-3xl font-bold text-purple-600">
                                    {errorStats.tense + errorStats.vocabulary + errorStats.grammar + errorStats.other}
                                </p>
                                <p className="text-xs text-purple-400 mt-1">纠错次数</p>
                            </div>
                        </div>

                        {/* 错误类型统计 */}
                        {(errorStats.tense + errorStats.vocabulary + errorStats.grammar + errorStats.other) > 0 && (
                            <div>
                                <h3 className="text-sm font-semibold text-gray-700 mb-2">错误分布</h3>
                                <div className="space-y-2">
                                    {(Object.entries(errorStats) as [keyof ErrorStats, number][]).map(([type, count]) =>
                                        count > 0 ? (
                                            <div key={type} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                                                <span className="text-sm text-gray-600">{ERROR_LABELS[type]}</span>
                                                <span className="text-sm font-bold text-red-500">{count} 次</span>
                                            </div>
                                        ) : null
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 改进建议 */}
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                            <h3 className="text-sm font-semibold text-amber-700 mb-1">改进建议</h3>
                            <p className="text-sm text-amber-800">{suggestion}</p>
                        </div>

                        {/* 对话历史 */}
                        <div>
                            <h3 className="text-sm font-semibold text-gray-700 mb-2">对话记录</h3>
                            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                                {conversationHistory.map((turn, index) => (
                                    <div key={index} className="border border-gray-100 rounded-lg p-3 space-y-2">
                                        <div className="flex gap-2">
                                            <span className="flex-shrink-0 text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-medium h-fit">你</span>
                                            <p className="text-sm text-gray-700">{turn.userText}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <span className="flex-shrink-0 text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded font-medium h-fit">AI</span>
                                            <p className="text-sm text-gray-600">{turn.aiReply}</p>
                                        </div>
                                        {turn.correction && (
                                            <div className="flex gap-2 pl-6">
                                                <span className="flex-shrink-0 text-xs text-teal-500">纠错：</span>
                                                <p className="text-xs text-teal-700">{turn.correction}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 关闭按钮 */}
                        <button
                            onClick={() => setShowSummary(false)}
                            className="w-full py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors cursor-pointer"
                        >
                            返回练习
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

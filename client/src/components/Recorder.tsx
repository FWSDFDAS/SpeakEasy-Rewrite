import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'

type RecordingStatus = 'idle' | 'recording' | 'stopped'

/** 场景类型 */
type SceneType = 'interview' | 'ordering' | 'meeting'

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

    // ASR 相关状态
    const [asrText, setAsrText] = useState<string | null>(null)
    const [isRecognizing, setIsRecognizing] = useState(false)
    const [asrError, setAsrError] = useState<string | null>(null)

    // Chat 相关状态
    const [chatReply, setChatReply] = useState<string | null>(null)
    const [chatCorrection, setChatCorrection] = useState<string | null>(null)
    const [isChatLoading, setIsChatLoading] = useState(false)

    // 课后总结相关状态
    const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([])
    const [showSummary, setShowSummary] = useState(false)

    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    // 清理资源
    const cleanup = useCallback(() => {
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
    }, [])

    // 组件卸载时清理
    useEffect(() => {
        return () => cleanup()
    }, [cleanup])

    /**
     * 根据纠错文本推断错误类型（简单关键词匹配）
     * @param correction 纠错建议文本
     */
    const classifyErrorType = useCallback((correction: string): keyof ErrorStats => {
        const lower = correction.toLowerCase()
        if (/tense|past|present|future|verb/.test(lower)) return 'tense'
        if (/word|vocabulary|choose|use\s+\w+/.test(lower)) return 'vocabulary'
        if (/grammar|sentence|structure|article|preposition/.test(lower)) return 'grammar'
        return 'other'
    }, [])

    /**
     * 从对话记录生成错误统计
     */
    const generateErrorStats = useCallback((): ErrorStats => {
        const stats: ErrorStats = { tense: 0, vocabulary: 0, grammar: 0, other: 0 }
        conversationHistory.forEach((turn) => {
            const type = classifyErrorType(turn.correction)
            stats[type]++
        })
        return stats
    }, [conversationHistory, classifyErrorType])

    /**
     * 根据对话情况生成改进建议
     */
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
     * @param text 用户说的话（ASR 识别结果）
     * @param scene 当前场景
     */
    const sendToChat = useCallback(async (text: string, scene: SceneType) => {
        setIsChatLoading(true)
        setChatReply(null)
        setChatCorrection(null)

        try {
            const response = await axios.post<ChatResponse>('/api/chat', { text, scene })
            const data = response.data

            if (data.success && data.reply) {
                setChatReply(data.reply)
                const corr = data.correction || ''
                setChatCorrection(corr || null)
                // 将本轮对话加入历史记录
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
    }, [])

    /**
     * 调用后端 ASR 接口进行语音识别，成功后自动调用 Chat
     */
    const sendToAsr = useCallback(async (blob: Blob) => {
        setIsRecognizing(true)
        setAsrError(null)
        setAsrText(null)
        setChatReply(null)
        setChatCorrection(null)

        try {
            const formData = new FormData()
            formData.append('audio', blob, 'recording.webm')

            const response = await axios.post<AsrResponse>(
                '/api/asr',
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
            const message =
                err instanceof Error ? err.message : '语音识别服务连接失败'
            setAsrError(message)
        } finally {
            setIsRecognizing(false)
        }
    }, [currentScene, sendToChat])

    // 开始录音
    const startRecording = useCallback(async () => {
        setError(null)
        setAudioBlob(null)
        setIsPlaying(false)
        setAsrText(null)
        setAsrError(null)
        setChatReply(null)
        setChatCorrection(null)
        chunksRef.current = []

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
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data)
                }
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
            setDuration(0)

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
    }, [cleanup, sendToAsr])

    // 停止录音
    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        if (timerRef.current) {
            clearInterval(timerRef.current)
            timerRef.current = null
        }
    }, [])

    // 播放录音
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

    // 开始新对话 → 重置所有状态
    const handleNewSession = useCallback(() => {
        setShowSummary(false)
        setConversationHistory([])
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

    return (
        <div className="flex flex-col items-center gap-6 p-8 bg-white rounded-2xl shadow-lg w-full max-w-md">
            {/* 标题 */}
            <h1 className="text-2xl font-bold text-gray-800">AI 英语口语陪练</h1>

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
                    <span className="text-red-500 font-medium">正在录音...</span>
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
                    开始录音
                </button>

                <button
                    onClick={stopRecording}
                    disabled={status !== 'recording'}
                    className={`px-6 py-2.5 rounded-xl font-medium text-white transition-all duration-200 cursor-pointer ${status !== 'recording'
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-red-500 hover:bg-red-600 active:scale-95 shadow-md hover:shadow-lg'
                        }`}
                >
                    停止录音
                </button>

                {/* 结束对话按钮：有对话记录时才显示 */}
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

            {/* 播放录音按钮 */}
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

            {/* 结果区域：ASR + Chat */}
            {(isRecognizing || isChatLoading || asrText || asrError || chatReply || chatCorrection) && !showSummary && (
                <div className="w-full border-t border-gray-100 pt-4 flex flex-col items-center gap-3">
                    {/* ASR 识别中 */}
                    {isRecognizing && (
                        <div className="flex items-center gap-2 text-indigo-500">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            <span className="text-sm font-medium">语音识别中...</span>
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
// PR #6 marker

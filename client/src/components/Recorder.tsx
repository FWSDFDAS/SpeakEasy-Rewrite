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
                setChatCorrection(data.correction || null)
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
                // ASR 成功后自动调用 AI 对话接口
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

    // 格式化时长显示
    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

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
                            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer border ${currentScene === scene.key
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
            {(isRecognizing || isChatLoading || asrText || asrError || chatReply || chatCorrection) && (
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
        </div>
    )
}

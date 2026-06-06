import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'

type RecordingStatus = 'idle' | 'recording' | 'stopped'

/** ASR 接口返回类型 */
interface AsrResponse {
    success: boolean
    text?: string
    error?: string
}

export default function Recorder() {
    const [status, setStatus] = useState<RecordingStatus>('idle')
    const [duration, setDuration] = useState(0)
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)

    // ASR 相关状态
    const [asrText, setAsrText] = useState<string | null>(null)
    const [isRecognizing, setIsRecognizing] = useState(false)
    const [asrError, setAsrError] = useState<string | null>(null)

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
     * 调用后端 ASR 接口进行语音识别
     * @param blob 录音生成的音频 Blob
     */
    const sendToAsr = useCallback(async (blob: Blob) => {
        setIsRecognizing(true)
        setAsrError(null)
        setAsrText(null)

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
    }, [])

    // 开始录音
    const startRecording = useCallback(async () => {
        setError(null)
        setAudioBlob(null)
        setIsPlaying(false)
        setAsrText(null)
        setAsrError(null)
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
                const blob = new Blob(chunksRef.current, {
                    type: mimeType || 'audio/webm',
                })
                setAudioBlob(blob)
                setStatus('stopped')
                cleanup()
                // 停止录音后自动调用 ASR 识别
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
        if (
            mediaRecorderRef.current &&
            mediaRecorderRef.current.state !== 'inactive'
        ) {
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
            <h1 className="text-2xl font-bold text-gray-800">语音录音机</h1>

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

            {/* 错误提示（录音相关） */}
            {error && (
                <div className="w-full p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm text-center">
                    {error}
                </div>
            )}

            {/* 操作按钮组 */}
            <div className="flex items-center gap-4">
                {/* 开始录音按钮 */}
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

                {/* 停止录音按钮 */}
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

            {/* 分隔线 */}
            {(isRecognizing || asrText || asrError) && (
                <div className="w-full border-t border-gray-100 pt-4 flex flex-col items-center gap-3">
                    {/* 识别中状态 */}
                    {isRecognizing && (
                        <div className="flex items-center gap-2 text-indigo-500">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                            <span className="text-sm font-medium">语音识别中...</span>
                        </div>
                    )}

                    {/* 识别结果 */}
                    {asrText && (
                        <div className="w-full p-4 bg-indigo-50 border border-indigo-200 rounded-xl">
                            <p className="text-xs text-indigo-400 mb-1">识别结果</p>
                            <p className="text-indigo-700 font-medium text-base">{asrText}</p>
                        </div>
                    )}

                    {/* ASR 错误提示 */}
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

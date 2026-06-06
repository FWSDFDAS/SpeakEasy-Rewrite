import { Router } from 'express'

const router = Router()

/** 支持的场景类型 */
export type SceneType = 'interview' | 'ordering' | 'meeting'

/** 各场景对应的 System Prompt */
const SCENE_PROMPTS: Record<SceneType, string> = {
    interview:
        'You are a job interviewer. Ask questions about work experience, strengths, weaknesses. Keep responses professional and concise.',
    ordering:
        'You are a restaurant waiter. Take the customer\'s order, ask about food preferences, recommend dishes. Be friendly and polite.',
    meeting:
        'You are a meeting host. Discuss project progress, ask for updates, suggest next steps. Keep it business-like but encouraging.',
}

/**
 * POST /api/chat
 * 接收用户文字和当前场景，返回 AI 回复和纠错信息
 *
 * 请求体：{ text: string, scene?: SceneType }
 * 响应：{ success: true, reply: string, correction: string, scene: string }
 */
router.post('/chat', async (req, res) => {
    try {
        const { text, scene } = req.body

        // 校验必填参数
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            res.status(400).json({ success: false, error: '请提供对话文字（text）' })
            return
        }

        // 校验并默认使用面试场景
        const validScenes: SceneType[] = ['interview', 'ordering', 'meeting']
        const selectedScene: SceneType = validScenes.includes(scene) ? (scene as SceneType) : 'interview'
        const systemPrompt = SCENE_PROMPTS[selectedScene]

        // 模拟模式：无需真实 AI API 即可测试完整流程
        const useMock = process.env.USE_MOCK_CHAT === 'true' || process.env.USE_MOCK_ASR === 'true'

        if (useMock) {
            const mockReplies: Record<SceneType, { reply: string; correction: string }> = {
                interview: {
                    reply: "That's impressive experience! Could you tell me more about your biggest challenge at your last job?",
                    correction: "Good job! Try using past tense consistently when describing past experiences.",
                },
                ordering: {
                    reply: "Great choice! Would you like any appetizers to start? Our soup of the day is tomato basil.",
                    correction: "Well done! Consider adding polite phrases like 'I would like' or 'Could I have please'.",
                },
                meeting: {
                    reply: "Thanks for the update. What blockers do you foresee for the upcoming sprint, and how can we help?",
                    correction: "Nice! Use more specific action verbs and try to quantify progress where possible.",
                },
            }

            const mock = mockReplies[selectedScene]
            return res.json({ success: true, ...mock, scene: selectedScene })
        }

        // 真实模式：调用 OpenAI 兼容接口
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey || apiKey === 'your_openai_api_key') {
            return res.status(500).json({
                success: false,
                error: '未配置 AI 密钥。请在 server/.env 设置 OPENAI_API_KEY，或开启 USE_MOCK_CHAT=true',
            })
        }

        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.AI_MODEL || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: text },
                ],
                max_tokens: 200,
                temperature: 0.7,
            }),
        })

        if (!aiResponse.ok) {
            throw new Error(`AI API 请求失败 (${aiResponse.status})`)
        }

        const aiData = await aiResponse.json()
        const reply = aiData.choices?.[0]?.message?.content || ''
        if (!reply) throw new Error('AI 未返回有效回复')

        // 纠错建议
        let correction = 'Keep practicing!'
        try {
            const corrRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: process.env.AI_MODEL || 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are an English tutor. Give ONE brief correction tip (under 30 words).' },
                        { role: 'user', content: text },
                    ],
                    max_tokens: 60,
                    temperature: 0.3,
                }),
            })
            if (corrRes.ok) {
                const corrData = await corrRes.json()
                correction = corrData.choices?.[0]?.message?.content || 'Keep practicing!'
            }
        } catch { /* 使用默认值 */ }

        res.json({ success: true, reply, correction, scene: selectedScene })
    } catch (err) {
        console.error('[Chat Error]', err)
        res.status(500).json({
            success: false,
            error: err instanceof Error ? err.message : '对话服务异常',
        })
    }
})

export default router

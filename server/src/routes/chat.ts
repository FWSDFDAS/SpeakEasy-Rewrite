import { Router } from 'express'

const router = Router()

/** 支持的场景类型 */
export type SceneType = 'interview' | 'ordering' | 'meeting'

/**
 * 对话历史中的一条消息（前端维护，每轮追加）
 */
export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
}

/** 各场景对应的 System Prompt — 像真人一样自然对话 */
const SCENE_PROMPTS: Record<SceneType, string> = {
    interview: `You are "Sarah", a friendly HR manager at a tech company. You're doing a casual but professional English practice interview with a Chinese learner.

ABOUT YOU:
- You're warm, patient, and genuinely curious about people
- You smile when you speak, use contractions ("I'm", "you'd", "let's")
- You react naturally — surprised, amused, impressed — like a real person

RULES:
- User may speak Chinese/English/mixed — understand everything, ALWAYS reply in English
- Reference what they actually said — never give generic responses
- Keep it under 40 words per reply
- Sound like you're having a real conversation, not reading a script

YOUR STYLE:
- "Oh nice! How long did you work there?" (not "Could you elaborate on your employment duration?")
- "Haha, same here! I'm terrible at waking up early too." (show personality)
- "Wait, really? That's actually super interesting — tell me more!" (genuine reactions)`,

    ordering: `You are "Mike", a chatty waiter at a cozy American diner. You're helping a Chinese learner practice ordering in English.

ABOUT YOU:
- You're laid-back, friendly, love recommending food
- You call customers "buddy" or "friend" sometimes
- You get excited about food

RULES:
- User may speak Chinese/English/mixed — understand everything, ALWAYS reply in English
- React to their actual order/desires naturally
- Under 35 words per reply
- Sound like a real waiter having fun at work

YOUR STYLE:
- "Oh, the burger? Great choice, that's our best seller!"
- "No spicy? Gotcha. Our honey chicken is amazing if you want something mild."
- "Sure thing! Anything to drink with that?"`,

    meeting: `You are "David", a team lead at an international company. You're in a quick standup meeting with a Chinese colleague.

ABOUT YOU:
- You're efficient but not cold — you care about your team
- You use workplace slang naturally ("circle back", "sync up", "on the same page")
- You appreciate concise updates

RULES:
- User may speak Chinese/English/mixed — understand everything, ALWAYS reply in English
- Respond to their actual update/status
- Under 45 words per reply
- Professional but human — like a real coworker

YOUR STYLE:
- "Good stuff. What do you need from me to unblock you?"
- "Nice, that's ahead of schedule. Let's sync on Thursday then?"
- "Got it. I'll loop in the design team — they should weigh in on this."`,
}

/**
 * 获取 AI 提供商配置（支持 OpenAI / DeepSeek）
 */
function getAiProvider() {
    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase()
    const apiKey = process.env.OPENAI_API_KEY || ''

    if (provider === 'deepseek') {
        return {
            baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
            apiKey,
            model: process.env.AI_MODEL || 'deepseek-chat',
            name: 'DeepSeek',
        }
    }

    return {
        baseUrl: 'https://api.openai.com/v1',
        apiKey,
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        name: 'OpenAI',
    }
}

/**
 * 调用 AI 聊天补全接口
 */
async function callAiChat(messages: Array<{ role: string; content: string }>, maxTokens: number, temperature: number): Promise<string> {
    const provider = getAiProvider()

    if (!provider.apiKey) {
        throw new Error(`未配置 ${provider.name} API 密钥`)
    }

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: provider.model,
            messages,
            max_tokens: maxTokens,
            temperature,
        }),
    })

    if (!response.ok) {
        const errText = await response.text().catch(() => '')
        throw new Error(`${provider.name} API 请求失败 (${response.status}): ${errText}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
}

/**
 * POST /api/chat
 *
 * 请求体：
 *   - text: string          当前用户输入的文字
 *   - scene?: SceneType      场景类型（interview/ordering/meeting），默认 interview
 *   - history?: ChatMessage[] 对话历史记录（用于维持上下文记忆）
 *
 * 响应：{ success: true, reply: string, correction: string, scene: string }
 */
router.post('/chat', async (req, res) => {
    try {
        const { text, scene, history } = req.body

        // 校验必填参数
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            res.status(400).json({ success: false, error: '请提供对话文字（text）' })
            return
        }

        // 校验场景
        const validScenes: SceneType[] = ['interview', 'ordering', 'meeting']
        const selectedScene: SceneType = validScenes.includes(scene) ? (scene as SceneType) : 'interview'
        const systemPrompt = SCENE_PROMPTS[selectedScene]

        // 模拟模式
        const useMock = process.env.USE_MOCK_CHAT === 'true' || process.env.USE_MOCK_ASR === 'true'

        if (useMock) {
            // 根据是否有历史记录返回不同的模拟回复（模拟有记忆的对话）
            const hasHistory = Array.isArray(history) && history.length > 0
            const mockReplies: Record<SceneType, { reply: string; correction: string }> = {
                interview: hasHistory ? {
                    reply: "That makes sense! Thanks for sharing. So moving on — what's one skill you'd most like to develop?",
                    correction: "Good flow! Try using transition phrases like 'Speaking of which...' or 'On that note...'",
                } : {
                    reply: "Hey! Thanks for coming in today. Let's start simple — could you tell me a bit about yourself?",
                    correction: "Great start! For self-introductions, try: 'I have X years of experience in Y, and I specialize in Z.'",
                },
                ordering: hasHistory ? {
                    reply: "Perfect, noted! And for drinks — we have fresh lemonade, iced tea, or soft drinks. What sounds good?",
                    correction: "Nice ordering! Next time try: 'I'll have...' instead of 'I want...' — it's more polite.",
                } : {
                    reply: "Hi there! Welcome to Sunny Side Diner. Have you been here before, or is this your first time?",
                    correction: "If a waiter greets you, try responding: 'This is my first time here!' or 'Yes, I love this place!'",
                },
                meeting: hasHistory ? {
                    reply: "Sounds good. I'll note that as blocked. Anyone else have updates before we wrap up?",
                    correction: "Great update! In meetings, use phrases like 'To summarize...' or 'The bottom line is...'",
                } : {
                    reply: "Alright everyone, let's keep this quick. Could each of you share one sentence on where things stand?",
                    correction: "For meeting openings, try: 'I wanted to quickly update everyone on my progress with...'",
                },
            }
            const mock = mockReplies[selectedScene]
            return res.json({ success: true, ...mock, scene: selectedScene })
        }

        // 真实模式：构建带历史的消息列表
        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: systemPrompt },
        ]

        // 追加对话历史（让 AI 有上下文记忆）
        if (Array.isArray(history) && history.length > 0) {
            // 只取最近 10 轮，避免 token 过多
            const recentHistory = history.slice(-10)
            for (const msg of recentHistory) {
                messages.push({ role: msg.role, content: msg.content })
            }
        }

        // 追加当前用户消息
        messages.push({ role: 'user', content: text })

        // 主请求：获取 AI 回复
        const reply = await callAiChat(messages, 200, 0.6)

        if (!reply) throw new Error('AI 未返回有效回复')

        // 纠错建议（独立请求，仅基于当前句子）
        let correction = 'Keep practicing!'
        try {
            correction = await callAiChat([
                {
                    role: 'system', content: `You are an expert English tutor for Chinese learners.
User speaks Chinese, English, or mixed. Give ONE brief correction tip.

Rules:
- If Chinese: translate to natural English as tip
- If broken English: fix biggest error
- If good: praise specifically
- Always English, under 25 words

Examples:
- "我昨天去上学了" → "Try: 'I went to school yesterday.' Use past tense 'went'."
- "I have three year experience" → "Say 'three YEARS of experience' — add 's' and 'of'!"
- "I would like a coffee please" → "Perfect! 'I would like' is very natural."` },
                { role: 'user', content: text },
            ], 80, 0.2)
        } catch { /* 使用默认值 */ }

        res.json({ success: true, reply, correction: correction || 'Keep practicing!', scene: selectedScene })
    } catch (err) {
        console.error('[Chat Error]', err)
        res.status(500).json({
            success: false,
            error: err instanceof Error ? err.message : '对话服务异常',
        })
    }
})

export default router

/**
 * Simulate Conversation — Multi-turn evaluation via simulated user.
 *
 * For each test case, runs k simulated conversations where an LLM plays
 * the user role and the candidate prompt config powers the agent.
 * Each conversation is then judged by an LLM evaluator.
 *
 * This is the core engine behind the optimization wizard's evaluation step.
 */

import {generateText, Output} from "ai"
import {z} from "zod"

import {
    resolveExecution,
    ensurePromptApp,
    parseAgentaResponse,
    type ExecutionParams,
} from "./execution"

// ─── Input/Output types ─────────────────────────────────────────────────────

export interface SimulateConversationInput {
    /** The candidate prompt config (full JSON string) to test */
    candidatePrompt: string
    /** Test case to evaluate */
    testCase: {
        id: string
        goal: string
        initialMessage: string
        expectedBehavior: string
        assertions: {type: string; value: string}[]
        maxTurns: number
    }
    /** Number of runs per test case */
    k: number
    /** Service URL for invoking the agent (from revision.data.url) */
    serviceUrl: string
    /** Agenta host (for resolving relative service URLs) */
    agentaHost?: string
}

export interface ConversationTurn {
    role: "user" | "assistant"
    content: string
    toolCalls?: {
        name: string
        arguments: Record<string, unknown>
        result?: unknown
    }[]
}

export interface ScenarioRun {
    runIndex: number
    turns: ConversationTurn[]
    passed: boolean
    score: number
    reasoning: string
    processNotes?: string
}

export interface SimulateConversationOutput {
    testCaseId: string
    goal: string
    initialMessage: string
    assertions: {type: string; value: string}[]
    runs: ScenarioRun[]
    passAny: boolean
    passAll: boolean
    averageScore: number
}

// ─── Simulated user prompt ──────────────────────────────────────────────────

const APP_SLUG = "optimization-simulate-user"
const APP_NAME = "Optimization: Simulate User"

const SIMULATE_USER_SYSTEM = `You are a simulated user testing an AI agent. Your job is to have a realistic conversation to determine if the agent achieves a specific goal.

## Your Role
- You play the USER in a conversation with an AI agent
- You have a specific goal you're trying to accomplish
- You behave like a real user — natural language, follow-ups, clarifications
- You do NOT reveal you are a simulator or mention the goal/assertions directly

## Rules
- Start with the provided initial message
- React naturally to the agent's responses
- If the agent asks for clarification, provide reasonable details
- If the agent seems stuck or going off-track, gently redirect
- Keep responses concise and natural (1-3 sentences typically)
- After the agent has adequately addressed your goal (or clearly failed), say exactly: [DONE]
- Do NOT continue past [DONE]

## Output Format
Return a JSON object with:
- **message**: Your next message as the user (or "[DONE]" if the conversation should end)
- **reasoning**: Brief internal note about why you're saying this (not shown to agent)`

function buildSimulateUserPrompt(
    goal: string,
    conversationHistory: ConversationTurn[],
    initialMessage: string,
): string {
    if (conversationHistory.length === 0) {
        return `## Goal\n${goal}\n\n## Initial Message\nSend this as your first message:\n${initialMessage}`
    }

    const transcript = conversationHistory
        .map((t) => `**${t.role === "user" ? "You" : "Agent"}**: ${t.content}`)
        .join("\n\n")

    return `## Goal\n${goal}\n\n## Conversation So Far\n${transcript}\n\nWhat do you say next? If the agent has achieved the goal (or clearly failed), respond with [DONE].`
}

// ─── Judge prompt ───────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are an expert evaluator assessing whether an AI agent successfully achieved a user's goal in a multi-turn conversation.

## Your Job
Review the full conversation transcript and the assertions, then determine:
1. Did the agent achieve the stated goal?
2. How well did it handle the conversation?

## Assertion Types
- **contains: <value>** — Final agent response must contain this text or concept
- **not_contains: <value>** — Final agent response must NOT contain this
- **tool_called: <name>** — Agent must have called this tool during the conversation
- **tool_not_called: <name>** — Agent must NOT have called this tool
- **llm_criteria: <description>** — A natural language criterion to evaluate

## Scoring (0.0 to 1.0)
- 1.0: Goal fully achieved, all assertions pass, excellent quality
- 0.7-0.9: Goal mostly achieved, most assertions pass
- 0.4-0.6: Partial success, some assertions pass
- 0.1-0.3: Mostly failed, few assertions pass
- 0.0: Complete failure

## Output Format
Return a JSON object with:
- **passed**: boolean — did the agent achieve the goal?
- **score**: number (0.0 to 1.0)
- **reasoning**: string — explain which assertions passed/failed
- **processNotes**: string — notes on tool usage, efficiency, conversation quality`

function buildJudgePrompt(
    goal: string,
    expectedBehavior: string,
    assertions: {type: string; value: string}[],
    turns: ConversationTurn[],
): string {
    const transcript = turns
        .map((t) => {
            let line = `**${t.role}**: ${t.content}`
            if (t.toolCalls?.length) {
                const toolLines = t.toolCalls
                    .map(
                        (tc) =>
                            `  → Tool: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)})`,
                    )
                    .join("\n")
                line += `\n${toolLines}`
            }
            return line
        })
        .join("\n\n")

    const assertionList =
        assertions.length > 0
            ? assertions.map((a) => `- ${a.type}: ${a.value}`).join("\n")
            : "No specific assertions — evaluate general quality."

    return `## Goal\n${goal}\n\n## Expected Behavior\n${expectedBehavior}\n\n## Assertions\n${assertionList}\n\n## Conversation Transcript\n${transcript}\n\nEvaluate whether the agent achieved the goal.`
}

// ─── Zod schemas for structured output ──────────────────────────────────────

const simulatedUserSchema = z.object({
    message: z.string(),
    reasoning: z.string(),
})

const judgeSchema = z.object({
    passed: z.boolean(),
    score: z.number(),
    reasoning: z.string(),
    processNotes: z.string().optional(),
})

// ─── Main function ──────────────────────────────────────────────────────────

export async function simulateConversation(
    params: ExecutionParams & {input: SimulateConversationInput},
): Promise<SimulateConversationOutput> {
    const {input} = params
    const {testCase, k, serviceUrl, agentaHost, candidatePrompt} = input
    const exec = resolveExecution(params, APP_SLUG)

    // Parse the candidate prompt config
    let promptConfig: Record<string, unknown>
    try {
        promptConfig = JSON.parse(candidatePrompt)
    } catch {
        throw new Error("candidatePrompt must be valid JSON")
    }

    // Ensure the simulate-user prompt app exists (Agenta mode)
    if (exec.mode === "agenta") {
        await ensurePromptApp(
            exec.agenta,
            exec.appSlug,
            APP_NAME,
            SIMULATE_USER_SYSTEM,
            exec.modelId,
            exec.environmentSlug,
        )
    }

    // Run k simulated conversations
    const runs: ScenarioRun[] = []

    for (let runIndex = 0; runIndex < k; runIndex++) {
        const turns: ConversationTurn[] = []
        let done = false

        for (let turn = 0; turn < testCase.maxTurns && !done; turn++) {
            // Step 1: Get the simulated user's message
            const userMessage = await getSimulatedUserMessage(
                exec,
                testCase.goal,
                turns,
                testCase.initialMessage,
            )

            if (userMessage === "[DONE]" || userMessage.includes("[DONE]")) {
                done = true
                break
            }

            turns.push({role: "user", content: userMessage})

            // Step 2: Get the agent's response by invoking the candidate prompt
            const agentResponse = await invokeAgent(serviceUrl, promptConfig, turns, agentaHost)

            turns.push({
                role: "assistant",
                content: agentResponse.content,
                toolCalls: agentResponse.toolCalls,
            })
        }

        // Step 3: Judge the conversation
        const judgment = await judgeConversation(
            exec,
            testCase.goal,
            testCase.expectedBehavior,
            testCase.assertions,
            turns,
        )

        runs.push({
            runIndex,
            turns,
            passed: judgment.passed,
            score: judgment.score,
            reasoning: judgment.reasoning,
            processNotes: judgment.processNotes,
        })
    }

    // Aggregate results
    const passAny = runs.some((r) => r.passed)
    const passAll = runs.every((r) => r.passed)
    const averageScore =
        runs.length > 0 ? runs.reduce((sum, r) => sum + r.score, 0) / runs.length : 0

    return {
        testCaseId: testCase.id,
        goal: testCase.goal,
        initialMessage: testCase.initialMessage,
        assertions: testCase.assertions,
        runs,
        passAny,
        passAll,
        averageScore,
    }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function getSimulatedUserMessage(
    exec: ReturnType<typeof resolveExecution>,
    goal: string,
    history: ConversationTurn[],
    initialMessage: string,
): Promise<string> {
    const prompt = buildSimulateUserPrompt(goal, history, initialMessage)

    // For the first turn, just return the initial message directly
    if (history.length === 0) {
        return initialMessage
    }

    if (exec.mode === "agenta") {
        const {data} = await exec.agenta.client.invokePrompt<unknown>(
            exec.appSlug,
            {user_prompt: prompt},
            exec.environmentSlug,
        )
        const parsed = parseAgentaResponse<{message: string}>(data)
        return parsed.message
    }

    const {experimental_output: output} = await generateText({
        model: exec.model,
        system: SIMULATE_USER_SYSTEM,
        prompt,
        output: Output.object({schema: simulatedUserSchema}),
    })

    return output?.message ?? "[DONE]"
}

async function invokeAgent(
    serviceUrl: string,
    promptConfig: Record<string, unknown>,
    conversationHistory: ConversationTurn[],
    agentaHost?: string,
): Promise<{content: string; toolCalls?: ConversationTurn["toolCalls"]}> {
    // Build the invoke URL
    let invokeUrl = serviceUrl.replace(/\/+$/, "")
    if (!invokeUrl.endsWith("/invoke")) {
        invokeUrl += "/invoke"
    }
    if (agentaHost && !invokeUrl.startsWith("http")) {
        invokeUrl = `${agentaHost.replace(/\/+$/, "")}${invokeUrl}`
    }

    // Build the inputs from conversation history
    // The last user message is the current input
    const lastUserMessage = [...conversationHistory].reverse().find((t) => t.role === "user")
    const inputs: Record<string, string> = {}
    if (lastUserMessage) {
        inputs.prompt = lastUserMessage.content
    }

    try {
        const res = await fetch(invokeUrl, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                data: {inputs},
                parameters: {prompt: promptConfig},
            }),
        })

        if (!res.ok) {
            const errText = await res.text().catch(() => "")
            return {content: `[Agent error: HTTP ${res.status} — ${errText.slice(0, 200)}]`}
        }

        const body = await res.json()

        // Normalize response (same logic as invoke-revision.ts)
        let content: string
        let toolCalls: ConversationTurn["toolCalls"] | undefined

        if (typeof body === "string") {
            content = body
        } else if (body?.data) {
            content = typeof body.data === "string" ? body.data : JSON.stringify(body.data)
        } else if (body?.message) {
            content = body.message
        } else if (body?.completion) {
            const completion = Array.isArray(body.completion) ? body.completion : [body.completion]
            const last = completion[completion.length - 1]
            content = typeof last?.content === "string" ? last.content : JSON.stringify(last)
        } else {
            content = JSON.stringify(body)
        }

        // Extract tool calls if present
        if (body?.tool_calls && Array.isArray(body.tool_calls)) {
            toolCalls = body.tool_calls.map((tc: Record<string, unknown>) => ({
                name: tc.name as string,
                arguments: (tc.arguments ?? tc.args ?? {}) as Record<string, unknown>,
                result: tc.result,
            }))
        }

        return {content, toolCalls}
    } catch (err) {
        return {content: `[Agent error: ${err instanceof Error ? err.message : String(err)}]`}
    }
}

async function judgeConversation(
    exec: ReturnType<typeof resolveExecution>,
    goal: string,
    expectedBehavior: string,
    assertions: {type: string; value: string}[],
    turns: ConversationTurn[],
): Promise<{passed: boolean; score: number; reasoning: string; processNotes?: string}> {
    const prompt = buildJudgePrompt(goal, expectedBehavior, assertions, turns)

    if (exec.mode === "agenta") {
        // Use the main optimization model for judging (not a separate app)
        const {data} = await exec.agenta.client.invokePrompt<unknown>(
            "optimization-judge-conversation",
            {user_prompt: prompt},
            exec.environmentSlug,
        )
        try {
            return parseAgentaResponse<{
                passed: boolean
                score: number
                reasoning: string
                processNotes?: string
            }>(data)
        } catch {
            return {passed: false, score: 0, reasoning: "Failed to parse judge response"}
        }
    }

    const {experimental_output: output} = await generateText({
        model: exec.model,
        system: JUDGE_SYSTEM,
        prompt,
        output: Output.object({schema: judgeSchema}),
    })

    return {
        passed: output?.passed ?? false,
        score: output?.score ?? 0,
        reasoning: output?.reasoning ?? "No evaluation produced",
        processNotes: output?.processNotes,
    }
}

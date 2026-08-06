import {generateText, Output} from "ai"
import {z} from "zod"

import {
    resolveExecution,
    ensurePromptApp,
    parseAgentaResponse,
    type ExecutionParams,
} from "./execution"
import {
    traceSection,
    feedbackSection,
    guidanceSection,
    toolsSection,
    promptConfigBlock,
    validatePromptJson,
    PROMPT_CONFIG_CONTEXT,
    PROMPT_CONFIG_RULES,
} from "./prompt-builders"
import {annotationSchema, traceSchema} from "./types"

// ─── Schema & types ─────────────────────────────────────────────────────────

export const generateCandidatesInputSchema = traceSchema.extend({
    currentPrompt: z.string(),
    availableTools: z.array(z.object({name: z.string(), description: z.string()})).optional(),
    userFeedback: annotationSchema.optional(),
    userGuidance: z.string().optional(),
    reflectionLog: z.string().optional(),
    round: z.number().default(1),
})

export type GenerateCandidatesInput = z.infer<typeof generateCandidatesInputSchema>

const candidateSchema = z.object({
    improvedPrompt: z.string(),
    changeDescription: z.string(),
    targetedWeaknesses: z.array(z.string()),
    approach: z.string(),
})

const candidatesResponseSchema = z.object({
    candidates: z.array(candidateSchema),
})

export type GenerateCandidatesOutput = z.infer<typeof candidatesResponseSchema>

// ─── Prompt construction ────────────────────────────────────────────────────

const APP_SLUG = "optimization-generate-candidates"
const APP_NAME = "Optimization: Generate Candidates"

const SYSTEM_PROMPT = `You are a prompt optimization expert. Your job is to generate 2-3 DIVERSE improvement candidates for an AI agent's prompt configuration.

${PROMPT_CONFIG_CONTEXT}

## Your Task
Generate exactly 2-3 improvement candidates. Each candidate MUST take a **different approach**:

### Approach Types (pick 2-3 different ones)
- **explicit_instructions**: Add clear, specific rules/constraints to the system message
- **few_shot**: Add or improve user/assistant example pairs that demonstrate desired behavior
- **restructure**: Reorganize the prompt structure (reorder sections, add headers, separate concerns)
- **tool_guidance**: Improve tool descriptions or add instructions about when/how to use tools
- **constraint_tightening**: Add guardrails, edge case handling, or negative examples
- **tone_calibration**: Adjust voice, formality, verbosity, or response structure

${PROMPT_CONFIG_RULES}
- Each candidate should be a COMPLETE, working prompt config (not a diff)
- Candidates must be meaningfully different from each other

## Output Format
Return a JSON object with a \`candidates\` array. Each candidate has:
- **improvedPrompt**: Full prompt config as JSON string
- **changeDescription**: 1-2 sentences explaining the change
- **targetedWeaknesses**: Specific failure patterns addressed
- **approach**: One of the approach types above`

function buildUserPrompt(parsed: GenerateCandidatesInput): string {
    const reflectionSection = parsed.reflectionLog
        ? `\n\n## Reflection Log (CRITICAL — READ CAREFULLY)
You are given a reflection log of prior improvement attempts. Each entry describes:
- What was tried (approach + description)
- Why it didn't fully work (diagnosis)
- Evaluation results (if available)

**You MUST learn from these prior attempts.** Do NOT repeat approaches that already failed.
Instead, try fundamentally different strategies. If explicit instructions didn't work, try
few-shot examples. If restructuring didn't help, try constraining tool usage. Be creative.

${parsed.reflectionLog}`
        : ""

    return `${promptConfigBlock(parsed.currentPrompt, parsed.round)}

## The Trace (What Actually Happened)
${traceSection(parsed.traceInput, parsed.traceOutput)}${toolsSection(parsed.availableTools)}${feedbackSection(parsed.userFeedback)}${guidanceSection(parsed.userGuidance)}${reflectionSection}

Generate 2-3 diverse improvement candidates. Each must take a fundamentally different approach.`
}

// ─── Main function ──────────────────────────────────────────────────────────

export async function generateCandidates(
    params: ExecutionParams & {input: GenerateCandidatesInput},
): Promise<GenerateCandidatesOutput> {
    const parsed = generateCandidatesInputSchema.parse(params.input)
    const exec = resolveExecution(params, APP_SLUG)

    const validateCandidates = (result: GenerateCandidatesOutput): GenerateCandidatesOutput => {
        if (!result?.candidates || result.candidates.length === 0) {
            throw new Error("No candidates generated")
        }
        return {
            candidates: result.candidates.map((c) => {
                const {value, valid} = validatePromptJson(c.improvedPrompt, parsed.currentPrompt)
                return valid
                    ? c
                    : {
                          ...c,
                          improvedPrompt: value,
                          changeDescription: `[Invalid JSON — original preserved] ${c.changeDescription}`,
                      }
            }),
        }
    }

    const prompt = buildUserPrompt(parsed)

    if (exec.mode === "agenta") {
        await ensurePromptApp(
            exec.agenta,
            exec.appSlug,
            APP_NAME,
            SYSTEM_PROMPT,
            exec.modelId,
            exec.environmentSlug,
        )

        const {data} = await exec.agenta.client.invokePrompt<GenerateCandidatesOutput>(
            exec.appSlug,
            {user_prompt: prompt},
            exec.environmentSlug,
        )
        return validateCandidates(parseAgentaResponse<GenerateCandidatesOutput>(data))
    }

    const {experimental_output: output} = await generateText({
        model: exec.model,
        system: SYSTEM_PROMPT,
        prompt,
        output: Output.object({schema: candidatesResponseSchema}),
    })

    return validateCandidates(output ?? {candidates: []})
}

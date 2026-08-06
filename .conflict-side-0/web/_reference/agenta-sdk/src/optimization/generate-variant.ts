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
    promptConfigBlock,
    validatePromptJson,
    PROMPT_CONFIG_CONTEXT,
    PROMPT_CONFIG_RULES,
} from "./prompt-builders"
import {annotationSchema, traceSchema} from "./types"

// ─── Schema & types ─────────────────────────────────────────────────────────

export const generateVariantInputSchema = traceSchema.extend({
    currentPrompt: z.string(),
    userFeedback: annotationSchema.optional(),
    priorChanges: z.string().optional(),
    userGuidance: z.string().optional(),
})

export type GenerateVariantInput = z.infer<typeof generateVariantInputSchema>

const variantSchema = z.object({
    improvedPrompt: z.string(),
    changeDescription: z.string(),
    targetedWeaknesses: z.array(z.string()),
})

export type GenerateVariantOutput = z.infer<typeof variantSchema>

// ─── Prompt construction ────────────────────────────────────────────────────

const APP_SLUG = "optimization-generate-variant"
const APP_NAME = "Optimization: Generate Variant"

const SYSTEM_PROMPT = `You are a prompt optimization expert. Your job is to improve an AI agent's full prompt configuration based on specific user feedback about a real interaction.

${PROMPT_CONFIG_CONTEXT}

## What You Can Change
- **System message content**: Add/edit instructions, constraints, rules
- **Tool descriptions**: Improve when/how tools should be used
- **Few-shot examples**: Add, remove, or edit user/assistant message pairs
- **Model parameters**: Adjust temperature if the agent is too random or too rigid
- **Tool parameter descriptions**: Clarify what arguments tools expect

${PROMPT_CONFIG_RULES}
- **One targeted change**: Prefer a single well-targeted improvement over many scattered changes

## Output Format
Return a JSON object with:
- **improvedPrompt**: The full prompt config as a JSON string (must be parseable JSON, same structure as input)
- **changeDescription**: 1-2 sentences explaining what you changed and why
- **targetedWeaknesses**: List of specific failure patterns you addressed`

function buildUserPrompt(parsed: GenerateVariantInput): string {
    const priorSection = parsed.priorChanges
        ? `\n\n## Prior Iteration Changes\nThe following changes were already made in a previous iteration — avoid repeating them if they didn't help:\n${parsed.priorChanges}`
        : ""

    return `${promptConfigBlock(parsed.currentPrompt)}

## The Trace (What Actually Happened)
${traceSection(parsed.traceInput, parsed.traceOutput)}${feedbackSection(parsed.userFeedback)}${guidanceSection(parsed.userGuidance)}${priorSection}

Analyze the configuration and fix it to address the feedback. Return the full improved configuration as a JSON string in \`improvedPrompt\`.`
}

// ─── Main function ──────────────────────────────────────────────────────────

export async function generateVariant(
    params: ExecutionParams & {input: GenerateVariantInput},
): Promise<GenerateVariantOutput> {
    const parsed = generateVariantInputSchema.parse(params.input)
    const exec = resolveExecution(params, APP_SLUG)

    const applyValidation = (result: GenerateVariantOutput | null): GenerateVariantOutput => {
        if (result?.improvedPrompt) {
            const {value, valid} = validatePromptJson(result.improvedPrompt, parsed.currentPrompt)
            if (!valid) {
                return {
                    improvedPrompt: value,
                    changeDescription: "Failed to generate valid JSON — no changes applied",
                    targetedWeaknesses: [],
                }
            }
        }
        return (
            result ?? {
                improvedPrompt: parsed.currentPrompt,
                changeDescription: "No changes generated",
                targetedWeaknesses: [],
            }
        )
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

        const {data} = await exec.agenta.client.invokePrompt<GenerateVariantOutput>(
            exec.appSlug,
            {user_prompt: prompt},
            exec.environmentSlug,
        )
        return applyValidation(parseAgentaResponse<GenerateVariantOutput>(data))
    }

    const {experimental_output: output} = await generateText({
        model: exec.model,
        system: SYSTEM_PROMPT,
        prompt,
        output: Output.object({schema: variantSchema}),
    })

    return applyValidation(output)
}

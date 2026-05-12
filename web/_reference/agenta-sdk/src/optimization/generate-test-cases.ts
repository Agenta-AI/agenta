import {generateText, Output} from "ai"
import {z} from "zod"

import {
    resolveExecution,
    ensurePromptApp,
    parseAgentaResponse,
    type ExecutionParams,
} from "./execution"
import {guidanceSection, toolsSection} from "./prompt-builders"
import {annotationSchema, toolRefSchema, traceSchema} from "./types"
import type {ToolRef} from "./types"

// ─── Schema & types ─────────────────────────────────────────────────────────

export const generateTestCasesInputSchema = traceSchema.extend({
    annotation: annotationSchema.optional(),
    tools: z.array(toolRefSchema).optional(),
    count: z.number().default(3),
    userGuidance: z.string().optional(),
})

export type GenerateTestCasesInput = z.infer<typeof generateTestCasesInputSchema>

const testCaseSchema = z.object({
    testCases: z.array(
        z.object({
            messages: z.array(z.object({role: z.string(), content: z.string()})),
            expectedOutput: z.string().optional(),
            assertions: z.array(
                z.object({
                    type: z.enum([
                        "contains",
                        "not_contains",
                        "tool_called",
                        "tool_not_called",
                        "llm_criteria",
                    ]),
                    value: z.string(),
                }),
            ),
        }),
    ),
})

export type GenerateTestCasesOutput = z.infer<typeof testCaseSchema>

// ─── Prompt construction ────────────────────────────────────────────────────

const APP_SLUG = "optimization-generate-test-cases"
const APP_NAME = "Optimization: Generate Test Cases"

function buildSystemPrompt(tools?: ToolRef[]): string {
    const toolHint = tools?.length
        ? `\n\nUse "tool_called" and "tool_not_called" assertion types to verify correct tool usage.`
        : ""

    return `You are a test case generator for an AI agent optimization system.

Given a seed trace (an actual user interaction with annotations/feedback), generate varied test cases that probe the specific failure mode.

## Your Task
1. Analyze the seed trace and the human feedback to understand what went wrong
2. Generate test cases that explore variations of the failure:
   - Different phrasings of similar requests
   - Edge cases that stress the same weakness
   - Adversarial inputs that could trigger the same failure
3. For each test case, generate assertions that define correct behavior

## Assertion Types
- **contains**: Output must contain this substring
- **not_contains**: Output must NOT contain this substring
- **tool_called**: This tool must be invoked (use exact tool name)
- **tool_not_called**: This tool must NOT be invoked (use exact tool name)
- **llm_criteria**: Natural language criterion evaluated by an LLM judge${toolsSection(tools)}${toolHint}

## Rules
- Do NOT duplicate the seed trace — create meaningful variations
- Each test case should have 1-3 assertions
- For "contains" / "not_contains", use short distinctive phrases, not full sentences
- For "llm_criteria", write a clear evaluable criterion (e.g., "Response provides actionable steps")
- Messages should be realistic user inputs (role: "user")
- expectedOutput is optional — include it when you can define what a correct response looks like
- Focus on the specific failure described in the annotation, not general quality

## Output Format
Return a JSON object with a \`testCases\` array. Each test case has:
- **messages**: Array of {role, content} objects
- **expectedOutput**: Optional string describing correct behavior
- **assertions**: Array of {type, value} objects`
}

function buildUserPrompt(parsed: GenerateTestCasesInput): string {
    return `## Seed Trace

### User Input
${parsed.traceInput}

### Agent Output
${parsed.traceOutput}

### Human Feedback
${parsed.annotation ? `- Label: ${parsed.annotation.label ?? "none"}\n- Score: ${parsed.annotation.score ?? "none"}\n- Comment: ${parsed.annotation.comment ?? "none"}` : "No annotation provided."}${guidanceSection(parsed.userGuidance)}

Generate ${parsed.count} test cases that probe this failure mode.`
}

// ─── Main function ──────────────────────────────────────────────────────────

export async function generateTestCases(
    params: ExecutionParams & {input: GenerateTestCasesInput},
): Promise<GenerateTestCasesOutput> {
    const parsed = generateTestCasesInputSchema.parse(params.input)
    const exec = resolveExecution(params, APP_SLUG)

    const system = buildSystemPrompt(parsed.tools)
    const prompt = buildUserPrompt(parsed)

    if (exec.mode === "agenta") {
        await ensurePromptApp(
            exec.agenta,
            exec.appSlug,
            APP_NAME,
            system,
            exec.modelId,
            exec.environmentSlug,
        )

        const {data} = await exec.agenta.client.invokePrompt<GenerateTestCasesOutput>(
            exec.appSlug,
            {user_prompt: prompt},
            exec.environmentSlug,
        )
        return parseAgentaResponse<GenerateTestCasesOutput>(data)
    }

    const {experimental_output: output} = await generateText({
        model: exec.model,
        system,
        prompt,
        output: Output.object({schema: testCaseSchema}),
    })

    return output ?? {testCases: []}
}

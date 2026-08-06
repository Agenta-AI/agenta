import type {Annotation, ToolRef} from "./types"

// ─── Reusable markdown blocks for user prompts ──────────────────────────────

export function traceSection(input: string, output: string): string {
    return `### User said:\n${input || "(empty)"}\n\n### Agent responded:\n${output || "(empty)"}`
}

export function feedbackSection(feedback?: Annotation): string {
    if (!feedback) return ""
    return `\n\n## User Feedback\n- Label: ${feedback.label ?? "none"}\n- Score: ${feedback.score ?? "none"}\n- Comment: ${feedback.comment ?? "none"}`
}

export function guidanceSection(guidance?: string): string {
    if (!guidance) return ""
    return `\n\n## User Guidance\n${guidance}`
}

export function toolsSection(tools?: ToolRef[]): string {
    if (!tools?.length) return ""
    return `\n\n## Available Tools\n${tools.map((t) => `- **${t.name}**${t.description ? `: ${t.description}` : ""}`).join("\n")}`
}

export function promptConfigBlock(config: string, round?: number): string {
    const header = round
        ? `## Current Prompt Configuration (Round ${round})`
        : `## Current Prompt Configuration`
    return `${header}\n\`\`\`json\n${config}\n\`\`\``
}

// ─── Shared system prompt fragments ─────────────────────────────────────────

export const PROMPT_CONFIG_CONTEXT = `## What You Receive
You receive the agent's **full prompt configuration** as a JSON object. This includes:
- **messages**: Array of messages (system, user, assistant). The system message is the main prompt. User/assistant pairs are few-shot examples.
- **llm_config**: Model settings (model name, temperature, max_tokens) and **tool definitions** (name, description, parameters).
- **input_keys**: Template variables used in the prompt.`

export const PROMPT_CONFIG_RULES = `## Critical Rules
- **Return valid JSON**: Your \`improvedPrompt\` MUST be the full config as a valid JSON string
- **PRESERVE structure**: Keep the same JSON schema — don't add/remove top-level keys
- **PRESERVE all messages you don't need to change**: Don't drop messages
- **PRESERVE tool schemas**: Don't modify tool \`parameters\` JSON schemas (those are code-defined), only modify tool \`description\` text
- **Don't invent new tools**: Only modify descriptions of existing tools
- **Focus on the feedback**: The user told you exactly what's wrong — fix THAT
- **Be specific**: Instead of "be more helpful", add concrete instructions`

// ─── Output helpers ─────────────────────────────────────────────────────────

/** Validate that a JSON string is parseable; return fallback if not. */
export function validatePromptJson(
    json: string,
    fallback: string,
): {value: string; valid: boolean} {
    try {
        JSON.parse(json)
        return {value: json, valid: true}
    } catch {
        return {value: fallback, valid: false}
    }
}

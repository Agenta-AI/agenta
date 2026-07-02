/**
 * Normalize an agent/LLM workflow's `parameters` object into a single
 * `AgentConfigView`, resolving the three overlapping schema shapes:
 *   - legacy nested:  parameters.prompt.{messages, llm_config.{model, tools, ...}}
 *   - canonical:      parameters.{messages, llms[0].{model, tools}}
 *   - flat root:      parameters.{messages, model, tools, temperature, ...}
 *
 * Pure and dependency-free so it can be unit-tested against fixtures for each shape.
 */
import {parseGatewayToolName} from "./gatewayName"
import {agentItemIdentity} from "./identity"
import type {AgentConfigView, NormalizedTool} from "./types"

/** Scalar config keys surfaced as "Advanced parameters". */
export const PARAM_KEYS = [
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "tool_choice",
    "response_format",
    "stream",
    "template_format",
    "fallback_policy",
    "retry_policy",
] as const

function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v)
}

function firstArray(...vals: unknown[]): unknown[] {
    for (const v of vals) if (Array.isArray(v)) return v
    return []
}

function firstDefined<T = unknown>(...vals: unknown[]): T | undefined {
    for (const v of vals) if (v !== undefined && v !== null) return v as T
    return undefined
}

function sortKeysDeep(value: unknown): unknown {
    if (!isObj(value)) return Array.isArray(value) ? value.map(sortKeysDeep) : value
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) out[k] = sortKeysDeep(value[k])
    return out
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value))
}

/** Coerce a message `content` (string | parts[] | object) into plain text. */
function coerceContent(content: unknown): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content
            .map((part) => (isObj(part) && typeof part.text === "string" ? part.text : ""))
            .filter(Boolean)
            .join("\n")
    }
    if (content == null) return ""
    return JSON.stringify(content)
}

/**
 * Normalize one tool entry. Every tool subtype is surfaced (nothing dropped): function/gateway
 * tools keyed by name, workflow-reference tools by slug, builtin/platform tools by type — so a
 * builtin or reference tool added/removed/edited still shows in the Tools diff. Field-level detail
 * only applies to function tools; the rest rely on `fingerprint` (the whole-tool hash) for edits.
 */
function normalizeTool(raw: unknown, index: number): NormalizedTool | null {
    if (!isObj(raw)) return null
    const key = agentItemIdentity("tool", raw, index)
    const fingerprint = stableStringify(raw)
    // Function tool: either the wrapped `{function:{name,...}}` shape or the flat legacy
    // `{name, description, parameters}` shape (guarded so reference/builtin tools, which carry a
    // non-function `type`, don't get misread as flat function tools).
    const fn = isObj(raw.function)
        ? raw.function
        : (raw.type === undefined || raw.type === "function") && typeof raw.name === "string"
          ? raw
          : undefined
    const fnName = fn && typeof fn.name === "string" ? fn.name : undefined

    // Function / gateway tool.
    if (fnName) {
        const parsed = parseGatewayToolName(fnName)
        const params = isObj(fn?.parameters) ? (fn?.parameters as Record<string, unknown>) : {}
        return {
            key,
            label: parsed.label,
            rawKey: fnName,
            source: parsed.source,
            description: typeof fn?.description === "string" ? fn.description : "",
            params,
            paramsJson: stableStringify(params),
            fingerprint,
            isFunction: true,
        }
    }

    // Workflow-reference tool (#4860) — keyed by the slug it targets.
    if (raw.type === "reference") {
        const slug = typeof raw.slug === "string" ? raw.slug : undefined
        return {
            key,
            label: slug || "Workflow tool",
            rawKey: slug,
            description: "",
            params: {},
            paramsJson: "{}",
            fingerprint,
            isFunction: false,
        }
    }

    // Builtin / platform tool (`{type:"web_search"}`, `{type:"platform", op}`) — a bare type.
    if (typeof raw.type === "string" && raw.type) {
        const op = typeof raw.op === "string" ? raw.op : undefined
        return {
            key,
            label: parseGatewayToolName(op || raw.type).label,
            rawKey: op ? `${raw.type}:${op}` : raw.type,
            description: "",
            params: {},
            paramsJson: "{}",
            fingerprint,
            isFunction: false,
        }
    }

    // Unrecognized shape — surface it (positional key) rather than silently drop it.
    return {
        key,
        label: "Tool",
        description: "",
        params: {},
        paramsJson: "{}",
        fingerprint,
        isFunction: false,
    }
}

export function readAgentConfig(parameters: unknown): AgentConfigView {
    const p = isObj(parameters) ? parameters : {}
    // agent-template shape: parameters.agent.{instructions.agents_md, llm.{model,...}, tools[]}
    const agent = isObj(p.agent) ? p.agent : undefined
    const prompt = isObj(p.prompt) ? p.prompt : undefined
    const llm0 =
        Array.isArray(p.llms) && isObj((p.llms as unknown[])[0])
            ? ((p.llms as unknown[])[0] as Record<string, unknown>)
            : undefined
    const llmConfig = prompt && isObj(prompt.llm_config) ? prompt.llm_config : undefined
    const llm = agent && isObj(agent.llm) ? agent.llm : isObj(p.llm) ? p.llm : undefined

    // Instructions: agent-template `instructions.agents_md` (or a string), else prompt messages.
    const messages = firstArray(prompt?.messages, p.messages, llm0?.messages)
    const messageInstructions = messages
        .map((m) => (isObj(m) ? coerceContent(m.content) : coerceContent(m)))
        .join("\n\n")
    const instrObj =
        agent && isObj(agent.instructions)
            ? agent.instructions
            : isObj(p.instructions)
              ? p.instructions
              : undefined
    const agentsMd = typeof instrObj?.agents_md === "string" ? instrObj.agents_md : undefined
    const instrStr =
        agent && typeof agent.instructions === "string"
            ? agent.instructions
            : typeof p.instructions === "string"
              ? p.instructions
              : undefined
    const instructions = agentsMd ?? instrStr ?? messageInstructions

    const toolsRaw = firstArray(agent?.tools, llmConfig?.tools, p.tools, llm0?.tools, prompt?.tools)
    const tools = toolsRaw
        .map((t, i) => normalizeTool(t, i))
        .filter((t): t is NormalizedTool => t !== null)

    const model = firstDefined<string>(
        llm?.model,
        llmConfig?.model,
        p.model,
        llm0?.model,
        agent?.model,
    )

    const paramSources = [llm, llmConfig, llm0, prompt, agent, p].filter(isObj) as Record<
        string,
        unknown
    >[]
    const params: Record<string, unknown> = {}
    for (const key of PARAM_KEYS) {
        for (const src of paramSources) {
            if (key in src) {
                params[key] = src[key]
                break
            }
        }
    }

    // Agent-template execution sections live at `agent.{harness,runner,sandbox}` (or the
    // template root when there's no `agent` wrapper).
    const section = (key: "harness" | "runner" | "sandbox") =>
        agent && isObj(agent[key]) ? agent[key] : isObj(p[key]) ? p[key] : undefined

    // Portable list sections (agent-template): flat on the definition.
    const mcps = firstArray(agent?.mcps, p.mcps)
    const skills = firstArray(agent?.skills, p.skills)

    return {
        instructions,
        tools,
        model,
        params,
        // Raw ModelRef (`{provider, model, connection}`) for the Model & harness section.
        llm: isObj(llm) ? llm : undefined,
        mcps,
        skills,
        harness: section("harness"),
        runner: section("runner"),
        sandbox: section("sandbox"),
    }
}

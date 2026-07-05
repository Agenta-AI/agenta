import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {ArrowRight, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {chatPanelMaximizedAtom} from "../state/panelLayout"

/** Curated starter prompts for the Build-mode empty state. Clicking one sends it. */
const BUILD_STARTERS = [
    "What can you do?",
    "Show me your current configuration",
    "List the tools you can call",
]

/** Read the agent config shape (same layout as ContextTab / buildAgentRequest). */
const agentModel = (config: unknown): string | null => {
    const a = (config as {agent?: {llm?: {model?: unknown}; model?: unknown}} | null)?.agent
    const m = a?.llm?.model ?? a?.model
    return typeof m === "string" && m ? m : null
}

const agentSummary = (config: unknown): string | null => {
    const md = (config as {agent?: {instructions?: {agents_md?: unknown}}} | null)?.agent
        ?.instructions?.agents_md
    if (typeof md !== "string" || !md.trim()) return null
    const line = md
        .trim()
        .split("\n")[0]
        .replace(/^#+\s*/, "")
    return line.length > 140 ? `${line.slice(0, 140)}…` : line
}

const capabilityLabel = (config: unknown): string | null => {
    const a = (config as {agent?: {tools?: unknown[]; skills?: unknown[]}} | null)?.agent
    const tools = Array.isArray(a?.tools) ? a!.tools!.length : 0
    const skills = Array.isArray(a?.skills) ? a!.skills!.length : 0
    const parts: string[] = []
    if (tools) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`)
    if (skills) parts.push(`${skills} skill${skills === 1 ? "" : "s"}`)
    return parts.length ? parts.join(" · ") : null
}

const Bot = ({size = 44}: {size?: number}) => (
    <div
        className="flex shrink-0 items-center justify-center rounded-full bg-colorFillTertiary"
        style={{width: size, height: size}}
    >
        <Robot size={Math.round(size * 0.5)} className="text-colorTextSecondary" />
    </div>
)

/**
 * The agent chat empty state, adapting to the playground mode:
 *  - Chat (maximized): a warm minimal welcome.
 *  - Build: an agent-aware card (name, model, capabilities, a one-line summary) plus starter
 *    prompts that send on click — for the team building the agent.
 */
const AgentChatEmptyState = ({
    entityId,
    onStart,
}: {
    entityId: string
    onStart: (text: string) => void
}) => {
    const buildMode = !useAtomValue(chatPanelMaximizedAtom)
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId))
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )

    if (!buildMode) {
        return (
            <div className="m-auto flex max-w-sm flex-col items-center gap-2.5 text-center">
                <Bot />
                <span className="!text-base !font-medium">What can I help you with?</span>
                <span className="!text-xs !leading-relaxed text-muted-foreground">
                    Ask a question, or describe a task you want this agent to run.
                </span>
            </div>
        )
    }

    const model = agentModel(config)
    const capabilities = capabilityLabel(config)
    const summary = agentSummary(config)

    return (
        <div className="m-auto w-full max-w-[420px]">
            <div className="flex flex-col gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-4">
                <div className="flex items-center gap-2.5">
                    <Bot size={34} />
                    <div className="min-w-0">
                        <span
                            className="!text-sm !font-medium block truncate"
                            title={name || "Agent"}
                        >
                            {name || "Agent"}
                        </span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {model ? (
                                <span className="rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer px-1.5 py-px font-mono text-[11px] text-colorTextSecondary">
                                    {model}
                                </span>
                            ) : null}
                            {capabilities ? (
                                <span className="rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer px-1.5 py-px text-[11px] text-colorTextSecondary">
                                    {capabilities}
                                </span>
                            ) : null}
                        </div>
                    </div>
                </div>

                {summary ? (
                    <span className="!text-xs !leading-relaxed text-muted-foreground">
                        {summary}
                    </span>
                ) : null}

                <div className="flex flex-col items-start gap-1.5">
                    <span className="!text-[11px] text-muted-foreground">Try</span>
                    {BUILD_STARTERS.map((starter) => (
                        <button
                            key={starter}
                            type="button"
                            onClick={() => onStart(starter)}
                            className="flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-solid border-colorBorder bg-colorBgContainer px-3 py-1.5 text-left text-xs text-colorTextSecondary transition-colors hover:border-colorPrimary hover:text-colorText"
                        >
                            <ArrowRight size={13} className="shrink-0" />
                            <span className="truncate">{starter}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

export default AgentChatEmptyState

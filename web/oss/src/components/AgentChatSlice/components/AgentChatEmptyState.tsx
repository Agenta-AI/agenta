import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {ArrowRight, Robot} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"

import {chatPanelMaximizedAtom} from "../state/panelLayout"

const {Text} = Typography

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
 *  - Build + first run: when the agent was just created with a starting prompt (`firstRunPrompt`),
 *    that prompt is shown prominently with a Start CTA instead of the generic starters — so the
 *    kickoff message reads as "here's what we'll do", not text the user has to notice in the input.
 */
const AgentChatEmptyState = ({
    entityId,
    onStart,
    firstRunPrompt,
    canStart = true,
}: {
    entityId: string
    onStart: (text: string) => void
    /** A just-created agent's starting prompt — surfaced here instead of pre-filling the composer. */
    firstRunPrompt?: string | null
    /** Whether the Start CTA is enabled (false when the model isn't connected). */
    canStart?: boolean
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
                <Text className="!text-base !font-medium">What can I help you with?</Text>
                <Text type="secondary" className="!text-xs !leading-relaxed">
                    Ask a question, or describe a task you want this agent to run.
                </Text>
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
                        <Text
                            className="!text-sm !font-medium block truncate"
                            title={name || "Agent"}
                        >
                            {name || "Agent"}
                        </Text>
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
                    <Text type="secondary" className="!text-xs !leading-relaxed">
                        {summary}
                    </Text>
                ) : null}

                {firstRunPrompt ? (
                    <div className="flex flex-col gap-2">
                        <Text
                            type="secondary"
                            className="!text-[11px] !font-medium uppercase tracking-wide"
                        >
                            We'll start with
                        </Text>
                        <div className="whitespace-pre-wrap break-words rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2 text-xs leading-relaxed text-colorText">
                            {firstRunPrompt}
                        </div>
                        <Button
                            type="primary"
                            disabled={!canStart}
                            onClick={() => onStart(firstRunPrompt)}
                            className="!inline-flex items-center gap-1.5 self-start !shadow-none"
                        >
                            Start
                            <ArrowRight size={14} />
                        </Button>
                        {canStart ? null : (
                            <Text type="secondary" className="!text-[11px]">
                                Connect a model below to start.
                            </Text>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-start gap-1.5">
                        <Text type="secondary" className="!text-[11px]">
                            Try
                        </Text>
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
                )}
            </div>
        </div>
    )
}

export default AgentChatEmptyState

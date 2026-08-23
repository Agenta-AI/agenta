import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {isHarnessBuiltinTool} from "../DrillInView/SchemaControls/toolUtils"

/** The model an agent runs on, from either config shape. */
const agentModel = (config: unknown): string | null => {
    const a = (config as {agent?: {llm?: {model?: unknown}; model?: unknown}} | null)?.agent
    const m = a?.llm?.model ?? a?.model
    return typeof m === "string" && m ? m : null
}

/** The first line of the agent's instructions, as a one-line summary. */
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

/** "2 tools · 1 skill", or null when the agent has neither. */
export const capabilityLabel = (config: unknown): string | null => {
    const a = (config as {agent?: {tools?: unknown[]; skills?: unknown[]}} | null)?.agent
    // Legacy harness built-in entries are ignored and render nowhere, so they must not be counted.
    const tools = Array.isArray(a?.tools)
        ? a!.tools!.filter((tool) => !isHarnessBuiltinTool(tool)).length
        : 0
    const skills = Array.isArray(a?.skills) ? a!.skills!.length : 0
    const parts: string[] = []
    if (tools) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`)
    if (skills) parts.push(`${skills} skill${skills === 1 ? "" : "s"}`)
    return parts.length ? parts.join(" · ") : null
}

const Bot = ({size = 34}: {size?: number}) => (
    <span
        className="flex shrink-0 items-center justify-center rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer"
        style={{width: size, height: size}}
    >
        <Robot size={Math.round(size * 0.5)} className="text-colorTextSecondary" />
    </span>
)

/**
 * Who you are about to talk to: the agent's name, the model it runs on, what it can reach, and the
 * first line of its instructions.
 *
 * This is what a conversation with no messages shows on BOTH chat surfaces. A blank session is not
 * an error state and must not read as one — /m rendered nothing at all there, and before that told
 * you its history was unavailable, which is a different and alarming claim.
 *
 * Resolved from `entityId` rather than taking a config prop, so both hosts feed it the one thing
 * they both have and cannot disagree about the shape underneath.
 */
export const AgentIntroCard = ({entityId, className}: {entityId: string; className?: string}) => {
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId))
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const model = agentModel(config)
    const capabilities = capabilityLabel(config)
    const summary = agentSummary(config)

    return (
        <div
            className={`flex flex-col gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-4 ${
                className ?? ""
            }`}
        >
            <div className="flex items-center gap-2.5">
                <Bot />
                <div className="min-w-0">
                    <span
                        className="block truncate text-sm font-medium text-colorText"
                        title={name || "Agent"}
                    >
                        {name || "Agent"}
                    </span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {model ? (
                            <span className="rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer px-1.5 py-px font-mono text-xs text-colorTextSecondary">
                                {model}
                            </span>
                        ) : null}
                        {capabilities ? (
                            <span className="rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer px-1.5 py-px text-xs text-colorTextSecondary">
                                {capabilities}
                            </span>
                        ) : null}
                    </div>
                </div>
            </div>
            {summary ? (
                <span className="text-xs leading-relaxed text-colorTextSecondary">{summary}</span>
            ) : null}
        </div>
    )
}

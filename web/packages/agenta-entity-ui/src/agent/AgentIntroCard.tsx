import {useMemo, type ReactNode} from "react"

import {harnessCapabilitiesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {createT, useT} from "@agenta/i18n"
import agentIntroCatalog from "@agenta/i18n/catalogs/entityUi.agentIntro"
import {IconTile, SimpleTooltip} from "@agenta/ui/ui"
import {Compass, Cpu, HardDrives, Robot, Wrench} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {
    modelDisplayName,
    type HarnessCapabilitiesMap,
} from "../DrillInView/SchemaControls/connectionUtils"
import {isHarnessBuiltinTool} from "../DrillInView/SchemaControls/toolUtils"

import {useAgentIconChrome} from "./agentIcon"

/** The model an agent runs on, from either config shape. */
const agentModel = (config: unknown): string | null => {
    const a = (config as {agent?: {llm?: {model?: unknown}; model?: unknown}} | null)?.agent
    const m = a?.llm?.model ?? a?.model
    return typeof m === "string" && m ? m : null
}

/** The harness the agent runs under, which picks the catalog its model name comes from. */
const agentHarness = (config: unknown): string | null => {
    const kind = (config as {agent?: {harness?: {kind?: unknown}}} | null)?.agent?.harness?.kind
    return typeof kind === "string" && kind ? kind : null
}

/**
 * What the card calls the agent's model: the catalog's curated name, else the bare model id. A
 * connection model key ("Agenta/custom/vertex_ai/gemini-3.7-flash") is routing detail, not a name,
 * so it never reaches the card whole. Null when the agent has no model.
 */
export const agentModelLabel = (
    config: unknown,
    capabilities: HarnessCapabilitiesMap | null | undefined,
): string | null => {
    const model = agentModel(config)
    return model ? modelDisplayName(capabilities, agentHarness(config), model) : null
}

/** The first line of the agent's instructions that is not its name, as a one-line summary. */
const agentSummary = (config: unknown, name?: string | null): string | null => {
    const md = (config as {agent?: {instructions?: {agents_md?: unknown}}} | null)?.agent
        ?.instructions?.agents_md
    if (typeof md !== "string" || !md.trim()) return null
    const line = md
        .split("\n")
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l && l !== name?.trim())
    if (!line) return null
    return line.length > 160 ? `${line.slice(0, 160)}…` : line
}

/** Counts of what the agent can reach, each its own chip. */
const agentCounts = (config: unknown) => {
    const a = (config as {agent?: {tools?: unknown[]; skills?: unknown[]; mcps?: unknown[]}} | null)
        ?.agent
    return {
        tools: Array.isArray(a?.tools)
            ? a!.tools!.filter((tool) => !isHarnessBuiltinTool(tool)).length
            : 0,
        mcps: Array.isArray(a?.mcps) ? a!.mcps!.length : 0,
        skills: Array.isArray(a?.skills) ? a!.skills!.length : 0,
    }
}

/** One fact about the agent: a 14px icon and a short label on a quiet chip. */
const Chip = ({icon, children, title}: {icon: ReactNode; children: ReactNode; title?: string}) => (
    <SimpleTooltip title={title}>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-secondary px-2 text-meta text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
            {icon}
            {children}
        </span>
    </SimpleTooltip>
)

const tNow = createT(agentIntroCatalog)

/** "2 tools · 1 skill", or null when the agent has neither. */
export const capabilityLabel = (config: unknown): string | null => {
    const a = (config as {agent?: {tools?: unknown[]; skills?: unknown[]}} | null)?.agent
    // Legacy harness built-in entries are ignored and render nowhere, so they must not be counted.
    const tools = Array.isArray(a?.tools)
        ? a!.tools!.filter((tool) => !isHarnessBuiltinTool(tool)).length
        : 0
    const skills = Array.isArray(a?.skills) ? a!.skills!.length : 0
    if (tools && skills) {
        return tNow("entityUi.agentIntro.toolsAndSkills", {
            tools: tNow("entityUi.agentIntro.toolsCount", {count: tools}),
            skills: tNow("entityUi.agentIntro.skillsCount", {count: skills}),
        })
    }
    if (tools) return tNow("entityUi.agentIntro.toolsCount", {count: tools})
    if (skills) return tNow("entityUi.agentIntro.skillsCount", {count: skills})
    return null
}

const HARNESS_CATALOG_KEY = "agenta:agent-intro-card"

/** The agent's own icon and tile color, or a grey Robot. */
const AgentMark = ({workflowId}: {workflowId?: string | null}) => {
    const chrome = useAgentIconChrome(workflowId, {
        size: 20,
        fallbackGlyph: <Robot />,
        fallbackClassName: "bg-secondary text-muted-foreground",
    })
    return (
        <IconTile size={40} aria-hidden className={chrome.className} style={chrome.style}>
            {chrome.glyph}
        </IconTile>
    )
}

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
    const t = useT(agentIntroCatalog)
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId))
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(entityId), [entityId]),
    )
    const workflowId = useAtomValue(workflowMolecule.selectors.workflowId(entityId))
    const harnessCapabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const model = agentModel(config)
    const modelLabel = agentModelLabel(config, harnessCapabilities)
    const counts = agentCounts(config)
    const label = name || t("entityUi.agentIntro.agent")
    const summary = agentSummary(config, name)

    // Centered, with no card: the empty conversation's own welcome.
    return (
        <div className={`flex flex-col items-center gap-3 text-center ${className ?? ""}`}>
            <AgentMark workflowId={workflowId} />
            <div className="flex flex-col items-center gap-1">
                <span className="text-title text-foreground">{label}</span>
                {summary ? (
                    <span className="max-w-[28rem] text-body text-muted-foreground">{summary}</span>
                ) : null}
            </div>
            {model || counts.tools || counts.mcps || counts.skills ? (
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {model ? (
                        <Chip icon={<Cpu />} title={model !== modelLabel ? model : undefined}>
                            {modelLabel}
                        </Chip>
                    ) : null}
                    {counts.tools ? (
                        <Chip icon={<Wrench />}>
                            {t("entityUi.agentIntro.toolsCount", {count: counts.tools})}
                        </Chip>
                    ) : null}
                    {counts.mcps ? (
                        <Chip icon={<HardDrives />}>
                            {t("entityUi.agentIntro.mcpCount", {count: counts.mcps})}
                        </Chip>
                    ) : null}
                    {counts.skills ? (
                        <Chip icon={<Compass />}>
                            {t("entityUi.agentIntro.skillsCount", {count: counts.skills})}
                        </Chip>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

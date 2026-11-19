import {useMemo} from "react"

import {harnessCapabilitiesAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {createT, useT} from "@agenta/i18n"
import agentIntroCatalog from "@agenta/i18n/catalogs/entityUi.agentIntro"
import {Robot} from "@phosphor-icons/react"
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

const Bot = ({size = 34, workflowId}: {size?: number; workflowId?: string | null}) => {
    const glyph = Math.round(size * 0.5)
    const chrome = useAgentIconChrome(workflowId, {
        size: glyph,
        fallbackGlyph: <Robot size={glyph} className="text-colorTextSecondary" />,
        fallbackClassName: "border border-solid border-colorBorderSecondary bg-colorBgContainer",
    })

    return (
        <span
            className={`flex shrink-0 items-center justify-center rounded-lg ${chrome.className}`}
            style={{width: size, height: size, ...chrome.style}}
        >
            {chrome.glyph}
        </span>
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
 * Resolved from `entityId` rather than taking a config prop, so a host cannot get the shape
 * underneath wrong.
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
    const capabilities = capabilityLabel(config)
    const summary = agentSummary(config)

    return (
        <div
            className={`flex flex-col gap-3 rounded-xl border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-4 ${
                className ?? ""
            }`}
        >
            <div className="flex items-center gap-2.5">
                <Bot workflowId={workflowId} />
                <div className="min-w-0">
                    <span
                        className="block truncate text-sm font-medium text-colorText"
                        title={name || t("entityUi.agentIntro.agent")}
                    >
                        {name || t("entityUi.agentIntro.agent")}
                    </span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {model ? (
                            <span
                                className="rounded-full border border-solid border-colorBorderSecondary bg-colorBgContainer px-1.5 py-px font-mono text-xs text-colorTextSecondary"
                                title={model}
                            >
                                {modelLabel}
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

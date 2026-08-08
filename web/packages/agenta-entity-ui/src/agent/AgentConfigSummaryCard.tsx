import {type ReactNode, useMemo} from "react"

import {
    ConfigAccordionSection,
    PANEL_ACTION_CLASS,
    PanelSection,
} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {
    CpuIcon,
    FileTextIcon,
    GraduationCapIcon,
    PlugsIcon,
    SlidersHorizontalIcon,
    WrenchIcon,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {InstructionsFileRow} from "../DrillInView/SchemaControls/agentTemplate/ItemRow"

import {agentConfigSummary} from "./agentConfigSummary"
import {agentLatestRevisionAtomFamily} from "./state"

const INSTRUCTIONS_FILE = "AGENTS.md"

interface ConfigRow {
    key: string
    icon: ReactNode
    title: string
    summary: string
    status: "default" | "complete" | "warning"
    /** Expands in place instead of leaving for the editor. */
    expands?: boolean
}

/** An unset row says what to do about it — every row opens the editor anyway. */
const emptyAction = (label: string) => ({summary: label, status: "default" as const})
const stated = (summary: string) => ({summary, status: "complete" as const})

export interface AgentConfigSummaryCardProps {
    appId: string
    /** Opens the editing surface (the playground on desktop). Absent = read-only host (mobile):
     * the Edit action and the row-level "opens elsewhere" affordances are hidden. */
    onEdit?: () => void
}

/**
 * What this agent IS, in one card.
 *
 * Built on the playground panel's own primitives rather than a second set: `ConfigAccordionSection`
 * is the same row (icon, title, right-aligned summary, chevron) with an `onOpen` mode meaning
 * "opens elsewhere", and `InstructionsFileRow` is the same file card the panel shows. Read-only —
 * configuration is edited in the playground, and a second editing surface would be two places to
 * change one thing.
 */
export const AgentConfigSummaryCard = ({appId, onEdit}: AgentConfigSummaryCardProps) => {
    // Configuration lives on a revision, not on the artifact — reading the artifact gave a
    // workflow with no parameters, so every row said "Not set".
    const revisionAtom = useMemo(() => agentLatestRevisionAtomFamily(appId), [appId])
    const revision = useAtomValue(revisionAtom)
    const summary = useMemo(
        () => agentConfigSummary(revision.data?.data?.parameters),
        [revision.data],
    )

    const model = [summary.model, summary.harness].filter(Boolean).join(" · ")
    const advanced = [
        summary.sandbox && `Sandbox: ${summary.sandbox.toLowerCase()}`,
        summary.permissions && `Permissions: ${summary.permissions.toLowerCase()}`,
    ]
        .filter(Boolean)
        .join(" · ")

    // Same order and icons as the playground's config sections, so this reads as a view of that
    // panel rather than a second account of the same settings.
    const rows: ConfigRow[] = [
        {
            key: "model",
            icon: <CpuIcon size={16} />,
            title: "Model & harness",
            // A model is the one required setting, so its absence is a warning rather than a gap.
            ...(model ? stated(model) : {summary: "Choose a model", status: "warning" as const}),
        },
        {
            key: "instructions",
            icon: <FileTextIcon size={16} />,
            title: "Instructions",
            ...(summary.instructions
                ? stated(`${INSTRUCTIONS_FILE} · ${summary.instructionWords} words`)
                : emptyAction("Add instructions")),
            // The one row whose summary can't stand in for its value — "28 words" says how much,
            // never what — so it expands in place instead of leaving for the editor.
            expands: Boolean(summary.instructions),
        },
        {
            key: "tools",
            icon: <WrenchIcon size={16} />,
            title: "Tools",
            ...(summary.tools ? stated(`${summary.tools} enabled`) : emptyAction("Add tools")),
        },
        {
            key: "mcps",
            icon: <PlugsIcon size={16} />,
            title: "MCP servers",
            ...(summary.mcps
                ? stated(`${summary.mcps} connected`)
                : emptyAction("Connect a server")),
        },
        {
            key: "skills",
            icon: <GraduationCapIcon size={16} />,
            title: "Skills",
            ...(summary.skills ? stated(`${summary.skills} available`) : emptyAction("Add skills")),
        },
        {
            key: "advanced",
            icon: <SlidersHorizontalIcon size={16} />,
            title: "Advanced",
            ...stated(advanced || "Defaults"),
        },
    ]

    return (
        <PanelSection
            title="Configuration"
            bodyClassName="flex flex-col px-4 pb-3"
            extra={
                onEdit ? (
                    <button type="button" onClick={onEdit} className={PANEL_ACTION_CLASS}>
                        Edit
                    </button>
                ) : undefined
            }
        >
            {revision.isPending ? (
                <div className="flex flex-col gap-2 py-1">
                    {rows.map((row) => (
                        <SkeletonBlock key={row.key} active className="h-6 w-full" />
                    ))}
                </div>
            ) : (
                rows.map((row) => (
                    <ConfigAccordionSection
                        key={row.key}
                        size="compact"
                        headerBand="-mx-4 px-4"
                        icon={row.icon}
                        title={row.title}
                        summary={row.summary}
                        status={row.status}
                        // `onOpen` is the primitive's "leaves for somewhere else" mode; only the
                        // expanding row (and a read-only host) omits it.
                        onOpen={row.expands || !onEdit ? undefined : onEdit}
                        defaultOpen={false}
                        // No row rules anywhere in this card: a line inside a section competes
                        // with the line that ends it. Rows separate by spacing.
                        noDivider
                    >
                        {row.expands ? (
                            <InstructionsFileRow
                                filename={INSTRUCTIONS_FILE}
                                content={summary.instructions ?? ""}
                                // The row demands a handler; a read-only host has nowhere to go.
                                onOpen={onEdit ?? (() => undefined)}
                            />
                        ) : null}
                    </ConfigAccordionSection>
                ))
            )}
        </PanelSection>
    )
}

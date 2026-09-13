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
    ShieldCheckIcon,
    WrenchIcon,
} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {InstructionsFileRow} from "../DrillInView/SchemaControls/agentTemplate/ItemRow"

import {agentConfigSummary} from "./agentConfigSummary"
import {SectionLoadError} from "./SectionLoadError"
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

/** Empty rows offer an action only when the host provides an editor. */
const emptyAction = (label: string) => ({summary: label, status: "default" as const})
// "default", not "complete": complete tints the icon green, and a read-only card full of
// green checkmark-colored icons reads as noise. Grey is the resting state; only the
// required-but-empty warning keeps a color.
const stated = (summary: string) => ({summary, status: "default" as const})

/** The tools row's noun; a host that calls it something else passes its own. */
export interface AgentConfigSummaryCopy {
    toolsTitle: string
    toolsCount: (count: number) => string
    toolsAdd: string
    toolsNone: string
}

const DEFAULT_COPY: AgentConfigSummaryCopy = {
    toolsTitle: "Tools",
    toolsCount: (count) => `${count} enabled`,
    toolsAdd: "Add tools",
    toolsNone: "None enabled",
}

export interface AgentConfigSummaryCardProps {
    appId: string
    /** Opens the editing surface (the playground on desktop). Absent = read-only host (mobile):
     * the Edit action and the row-level "opens elsewhere" affordances are hidden. */
    onEdit?: () => void
    /** Overrides the tools row's wording; defaults to the "tool" noun oss/ee use. */
    copy?: Partial<AgentConfigSummaryCopy>
}

/** What this agent IS, in one read-only card, built on the playground panel's own row primitives. */
export const AgentConfigSummaryCard = ({
    appId,
    onEdit,
    copy: copyOverrides,
}: AgentConfigSummaryCardProps) => {
    const copy = useMemo<AgentConfigSummaryCopy>(
        () => ({...DEFAULT_COPY, ...copyOverrides}),
        [copyOverrides],
    )
    // Configuration lives on a revision, not on the artifact — reading the artifact gave a
    // workflow with no parameters, so every row said "Not set".
    const revisionAtom = useMemo(() => agentLatestRevisionAtomFamily(appId), [appId])
    const revision = useAtomValue(revisionAtom)
    const summary = useMemo(
        () => agentConfigSummary(revision.data?.data?.parameters),
        [revision.data],
    )

    // Model id only. The harness rode along as "· Pi core", which is the one part of this string a
    // narrow row can least afford and the least likely thing anyone is checking here.
    const model = summary.model ?? ""

    // Same order and icons as the playground's config sections, so this reads as a view of that
    // panel rather than a second account of the same settings.
    const rows: ConfigRow[] = [
        {
            key: "model",
            icon: <CpuIcon size={16} />,
            // "Model", not "Model & harness": the harness no longer shows in the summary, and the
            // playground's own section is labelled "Model" too.
            title: "Model",
            // A model is the one required setting, so its absence is a warning rather than a gap.
            ...(summary.model
                ? stated(model)
                : {summary: onEdit ? "Choose a model" : "Not set", status: "warning" as const}),
        },
        {
            key: "instructions",
            icon: <FileTextIcon size={16} />,
            title: "Instructions",
            ...(summary.instructions
                ? stated(`${INSTRUCTIONS_FILE} · ${summary.instructionWords} words`)
                : emptyAction(onEdit ? "Add instructions" : "No instructions")),
            // The one row whose summary can't stand in for its value — "28 words" says how much,
            // never what — so it expands in place instead of leaving for the editor.
            expands: Boolean(summary.instructions),
        },
        {
            key: "tools",
            icon: <WrenchIcon size={16} />,
            title: copy.toolsTitle,
            ...(summary.tools
                ? stated(copy.toolsCount(summary.tools))
                : emptyAction(onEdit ? copy.toolsAdd : copy.toolsNone)),
        },
        {
            key: "mcps",
            icon: <PlugsIcon size={16} />,
            title: "MCP servers",
            ...(summary.mcps
                ? stated(`${summary.mcps} connected`)
                : emptyAction(onEdit ? "Connect a server" : "None connected")),
        },
        {
            key: "skills",
            icon: <GraduationCapIcon size={16} />,
            title: "Skills",
            ...(summary.skills
                ? stated(`${summary.skills} ${summary.skills === 1 ? "skill" : "skills"}`)
                : emptyAction(onEdit ? "Add skills" : "None available")),
            // Expands to the skill names — the count alone says how many, never which.
            expands: summary.skillNames.length > 0,
        },
        {
            key: "permissions",
            icon: <ShieldCheckIcon size={16} />,
            title: "Permissions",
            ...stated(summary.permissions || "Not set"),
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
            ) : revision.isError ? (
                <SectionLoadError
                    message="Couldn't load this agent's configuration."
                    onRetry={() => void revision.refetch()}
                />
            ) : (
                rows.map((row) => (
                    <ConfigAccordionSection
                        key={row.key}
                        size="compact"
                        headerBand={row.expands ? "-mx-4 px-4" : undefined}
                        bodyClassName={row.expands ? undefined : ""}
                        icon={row.icon}
                        title={row.title}
                        summary={row.summary}
                        status={row.status}
                        preserveTitle={row.key === "model" || row.key === "permissions"}
                        // `onOpen` is the primitive's "leaves for somewhere else" mode; only the
                        // expanding row (and a read-only host) omits it.
                        onOpen={row.expands || !onEdit ? undefined : onEdit}
                        collapsible={Boolean(row.expands)}
                        defaultOpen={false}
                        // No row rules anywhere in this card: a line inside a section competes
                        // with the line that ends it. Rows separate by spacing.
                        noDivider
                    >
                        {row.expands && row.key === "instructions" ? (
                            <InstructionsFileRow
                                filename={INSTRUCTIONS_FILE}
                                content={summary.instructions ?? ""}
                                // The row demands a handler; a read-only host has nowhere to go.
                                onOpen={onEdit ?? (() => undefined)}
                            />
                        ) : null}
                        {row.expands && row.key === "skills" ? (
                            <div className="flex flex-wrap gap-1.5">
                                {summary.skillNames.map((name) => (
                                    <span
                                        key={name}
                                        className="rounded-full border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-2 py-px font-mono text-[11px]"
                                    >
                                        {name}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </ConfigAccordionSection>
                ))
            )}
        </PanelSection>
    )
}

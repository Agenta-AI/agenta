import {type ReactNode, useMemo} from "react"

import {InstructionsFileRow} from "@agenta/entity-ui"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {
    CpuIcon,
    FileTextIcon,
    GraduationCapIcon,
    PlugsIcon,
    SlidersHorizontalIcon,
    WrenchIcon,
} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {PanelSection} from "@/oss/components/PanelSection"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"

import {agentConfigSummary} from "./agentConfigSummary"
import {agentLatestRevisionAtomFamily} from "./state"

const INSTRUCTIONS_FILE = "AGENTS.md"

interface ConfigRow {
    key: string
    icon: ReactNode
    title: string
    summary: string
    status: "default" | "complete" | "warning"
    /** Expands in place instead of leaving for the playground. */
    expands?: boolean
}

/** An unset row says what to do about it — every row opens the playground anyway. */
const emptyAction = (label: string) => ({summary: label, status: "default" as const})
const stated = (summary: string) => ({summary, status: "complete" as const})

/**
 * What this agent IS, in one card.
 *
 * Built on the playground panel's own primitives rather than a second set: `ConfigAccordionSection`
 * is the same row (icon, title, right-aligned summary, chevron) with an `onOpen` mode meaning
 * "opens elsewhere", and `InstructionsFileRow` is the same file card the panel shows. Read-only —
 * configuration is edited in the playground, and a second editing surface would be two places to
 * change one thing.
 */
const AgentConfigurationCard = ({appId}: {appId: string}) => {
    const {goToPlayground} = usePlaygroundNavigation()
    // Configuration lives on a revision, not on the artifact — reading the artifact gave a
    // workflow with no parameters, so every row said "Not set".
    const revisionAtom = useMemo(() => agentLatestRevisionAtomFamily(appId), [appId])
    const revision = useAtomValue(revisionAtom)
    const summary = useMemo(
        () => agentConfigSummary(revision.data?.data?.parameters),
        [revision.data],
    )

    const open = () => goToPlayground(undefined, {appId})

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
            // never what — so it expands in place instead of leaving for the playground.
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
            bodyClassName="flex flex-col px-4 pb-2"
            extra={
                <button
                    type="button"
                    onClick={open}
                    className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorPrimary"
                >
                    Edit
                </button>
            }
        >
            {revision.isPending ? (
                <Skeleton active paragraph={{rows: 5}} title={false} />
            ) : (
                rows.map((row, index) => (
                    <ConfigAccordionSection
                        key={row.key}
                        size="compact"
                        headerBand="-mx-4 px-4"
                        icon={row.icon}
                        title={row.title}
                        summary={row.summary}
                        status={row.status}
                        // `onOpen` is the primitive's "leaves for somewhere else" mode; only the
                        // expanding row omits it.
                        onOpen={row.expands ? undefined : open}
                        defaultOpen={false}
                        noDivider={index === rows.length - 1}
                    >
                        {row.expands ? (
                            <InstructionsFileRow
                                filename={INSTRUCTIONS_FILE}
                                content={summary.instructions ?? ""}
                                onOpen={open}
                            />
                        ) : null}
                    </ConfigAccordionSection>
                ))
            )}
        </PanelSection>
    )
}

export default AgentConfigurationCard

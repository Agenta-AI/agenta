import {useMemo} from "react"

import {composioLogo, PROVIDERS} from "@agenta/entities/workflow"
import {
    AGENT_CONFIG_ROW_TITLES,
    agentConfigSummary,
    agentLatestRevisionAtomFamily,
    instructionsSummaryDetail,
    mcpSummaryDetail,
    permissionsSummaryDetail,
    skillsSummaryDetail,
    toolsCopyFor,
} from "@agenta/entity-ui/agent"
import {humanizeActionKey} from "@agenta/shared/utils"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {Cpu, FileText, GraduationCap, Plugs, ShieldCheck, Wrench} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardError} from "./states/AgentOverviewCardError"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

const ICON = 16
/** This card calls tools integrations; the rest of the row's wording is the shared one. */
const TOOLS_COPY = toolsCopyFor("integrations", "Integrations")
/** Marks past this collapse to "+N" — a phone row cannot hold a longer run. */
const MAX_MARKS = 4

/** `openrouter/deepseek/deepseek-v4-flash` → `deepseek-v4-flash`: the row is for the model, and the
 * route and provider in front of it are what pushed the model off the end. The full id stays in
 * the tooltip. */
const modelName = (id: string): string => id.split("/").filter(Boolean).pop() ?? id

/** What this agent IS: the playground's config sections, one row each, less the permission default. */
export const AgentConfigCard = ({
    agentId,
    onEdit,
}: {
    agentId: string
    /** Opens the config for editing; every row leads there too. */
    onEdit: () => void
}) => {
    // Configuration lives on a revision, not on the artifact.
    const revisionAtom = useMemo(() => agentLatestRevisionAtomFamily(agentId), [agentId])
    const revision = useAtomValue(revisionAtom)
    const summary = useMemo(
        () => agentConfigSummary(revision.data?.data?.parameters),
        [revision.data],
    )

    const marks = useMemo(
        () =>
            summary.integrationKeys.map((key) => ({
                key,
                name: PROVIDERS[key]?.label ?? humanizeActionKey(key),
                logo: PROVIDERS[key]?.logo ?? composioLogo(key),
            })),
        [summary.integrationKeys],
    )

    // User MCP servers are a Claude-harness feature; on any other harness the row only offers a
    // setting the runtime ignores — unless a server is already configured, which is worth saying.
    const showMcp = summary.mcps > 0 || Boolean(summary.harness?.toLowerCase().includes("claude"))

    // The names when there are any, because a narrow row can hold them and "3 skills" says how
    // many and never which. The count and the empty action are the shared ones.
    const skills =
        summary.skillNames.length > 0
            ? summary.skillNames.join(", ")
            : skillsSummaryDetail(summary.skills, {canEdit: true})

    return (
        <AgentOverviewCard title="Configuration" action="Edit" onAction={onEdit}>
            {revision.isPending ? (
                <AgentOverviewCardSkeleton rows={6} />
            ) : revision.isError ? (
                <AgentOverviewCardError
                    message="Couldn't load this agent's configuration."
                    onRetry={() => void revision.refetch()}
                />
            ) : (
                <>
                    <AgentOverviewCardRow
                        icon={<Cpu size={ICON} />}
                        label={AGENT_CONFIG_ROW_TITLES.model}
                        detail={summary.model ? modelName(summary.model) : "Choose a model"}
                        title={summary.model ?? undefined}
                        onClick={onEdit}
                    />
                    <AgentOverviewCardRow
                        icon={<FileText size={ICON} />}
                        label={AGENT_CONFIG_ROW_TITLES.instructions}
                        detail={instructionsSummaryDetail(summary.instructionWords, {
                            canEdit: true,
                        })}
                        onClick={onEdit}
                    />
                    <AgentOverviewCardRow
                        icon={<Wrench size={ICON} />}
                        label={TOOLS_COPY.toolsTitle}
                        detail={
                            marks.length > 0 ? (
                                <LogoMarks
                                    items={marks}
                                    size={16}
                                    max={MAX_MARKS}
                                    stacked
                                    label={TOOLS_COPY.toolsTitle}
                                />
                            ) : summary.tools ? (
                                TOOLS_COPY.toolsCount(summary.tools)
                            ) : (
                                // The row opens the editor, so an empty one offers the action
                                // rather than reporting the absence, as every other row here does.
                                TOOLS_COPY.toolsAdd
                            )
                        }
                        onClick={onEdit}
                    />
                    {showMcp ? (
                        <AgentOverviewCardRow
                            icon={<Plugs size={ICON} />}
                            label={AGENT_CONFIG_ROW_TITLES.mcps}
                            // The shared card's rule, not this fork's own wording: it said
                            // "connected", which claims an authorized state no summary card
                            // can know, and which the shared card was fixed away from.
                            detail={mcpSummaryDetail(summary.mcps, {canEdit: true})}
                            onClick={onEdit}
                        />
                    ) : null}
                    <AgentOverviewCardRow
                        icon={<GraduationCap size={ICON} />}
                        label={AGENT_CONFIG_ROW_TITLES.skills}
                        detail={skills}
                        title={summary.skillNames.join(", ") || undefined}
                        onClick={onEdit}
                    />
                    {/* The shared card's last row, which this one never had: the agent's default
                        tool permission is the setting that decides whether a run stops to ask, and
                        a card claiming to say what the agent IS cannot leave it out. */}
                    <AgentOverviewCardRow
                        icon={<ShieldCheck size={ICON} />}
                        label={AGENT_CONFIG_ROW_TITLES.permissions}
                        detail={permissionsSummaryDetail(summary.permissions)}
                        onClick={onEdit}
                    />
                </>
            )}
        </AgentOverviewCard>
    )
}

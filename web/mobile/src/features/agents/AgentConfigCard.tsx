import {useMemo} from "react"

import {composioLogo, PROVIDERS} from "@agenta/entities/workflow"
import {agentConfigSummary, agentLatestRevisionAtomFamily} from "@agenta/entity-ui/agent"
import {humanizeActionKey} from "@agenta/shared/utils"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {Cpu, FileText, GraduationCap, Plugs, Wrench} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AgentOverviewCard} from "./AgentOverviewCard"
import {AgentOverviewCardRow} from "./AgentOverviewCardRow"
import {AgentOverviewCardError} from "./states/AgentOverviewCardError"
import {AgentOverviewCardSkeleton} from "./states/AgentOverviewCardSkeleton"

const ICON = 16
const INSTRUCTIONS_FILE = "AGENTS.md"
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

    const skills =
        summary.skillNames.length > 0
            ? summary.skillNames.join(", ")
            : summary.skills
              ? `${summary.skills} ${summary.skills === 1 ? "skill" : "skills"}`
              : "No skills"

    return (
        <AgentOverviewCard title="Configuration" action="Edit" onAction={onEdit}>
            {revision.isPending ? (
                <AgentOverviewCardSkeleton rows={4} />
            ) : revision.isError ? (
                <AgentOverviewCardError
                    message="Couldn't load this agent's configuration."
                    onRetry={() => void revision.refetch()}
                />
            ) : (
                <>
                    <AgentOverviewCardRow
                        icon={<Cpu size={ICON} />}
                        label="Model"
                        detail={summary.model ? modelName(summary.model) : "Choose a model"}
                        title={summary.model ?? undefined}
                        onClick={onEdit}
                    />
                    <AgentOverviewCardRow
                        icon={<FileText size={ICON} />}
                        label="Instructions"
                        detail={
                            summary.instructions
                                ? `${INSTRUCTIONS_FILE} · ${summary.instructionWords}w`
                                : "Add instructions"
                        }
                        onClick={onEdit}
                    />
                    <AgentOverviewCardRow
                        icon={<Wrench size={ICON} />}
                        label="Integrations"
                        detail={
                            marks.length > 0 ? (
                                <LogoMarks
                                    items={marks}
                                    size={16}
                                    max={MAX_MARKS}
                                    stacked
                                    label="Integrations"
                                />
                            ) : summary.tools ? (
                                `${summary.tools} enabled`
                            ) : (
                                "No integrations"
                            )
                        }
                        onClick={onEdit}
                    />
                    {showMcp ? (
                        <AgentOverviewCardRow
                            icon={<Plugs size={ICON} />}
                            label="MCP servers"
                            detail={summary.mcps ? `${summary.mcps} connected` : "Connect a server"}
                            onClick={onEdit}
                        />
                    ) : null}
                    <AgentOverviewCardRow
                        icon={<GraduationCap size={ICON} />}
                        label="Skills"
                        detail={skills}
                        title={summary.skillNames.join(", ") || undefined}
                        onClick={onEdit}
                    />
                </>
            )}
        </AgentOverviewCard>
    )
}

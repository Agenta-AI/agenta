import {useCallback, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentChip} from "@agenta/entity-ui/agent"
import {LoadError} from "@agenta/ui/components/presentational"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {FeatureActionCard} from "../education/FeatureActionCard"
import {FeatureSection} from "../education/FeatureSection"
import {FeatureTemplateStarters} from "../education/FeatureTemplateStarters"
import {FeatureTemplateGridSkeleton} from "../education/states/FeatureTemplateGridSkeleton"

const SHOWN = 3

/** With agents, start an automation from one of them; without, an agent template comes first. */
export const AutomationAgentStarters = ({base}: {base: string}) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const query = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo(
        () =>
            [...(query.data ?? [])]
                .sort(
                    (a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0,
                )
                .slice(0, SHOWN),
        [query.data],
    )

    // The roster is a query atom with no refetch handle of its own; the agents list retries the
    // same way, by invalidating the key it is cached under.
    const retry = useCallback(
        () => void queryClient.invalidateQueries({queryKey: ["workflows"]}),
        [queryClient],
    )

    if (query.isPending) return <FeatureTemplateGridSkeleton count={SHOWN} />
    // A failed fetch must not read as "no agents" and offer agent templates instead.
    if (query.isError) return <LoadError title="Could not load agents" onRetry={retry} />
    if (agents.length === 0) return <FeatureTemplateStarters guideKey="automations" base={base} />

    return (
        <FeatureSection
            title="Run one of your agents"
            link={{href: `${base}/agents`, label: "View all agents"}}
        >
            <div className="grid gap-3 @2xl:grid-cols-3">
                {agents.map((agent) => (
                    <FeatureActionCard
                        key={agent.id}
                        media={<AgentChip workflowId={agent.id} box="size-[30px]" glyph={16} />}
                        title={agent.name || agent.slug || "Untitled agent"}
                        description={agent.description || "No description yet."}
                        actionLabel="Set up an automation"
                        meta="Agent"
                        onClick={() =>
                            void router.push({
                                pathname: `${base}/automations/new`,
                                query: {agent: agent.id},
                            })
                        }
                    />
                ))}
            </div>
        </FeatureSection>
    )
}

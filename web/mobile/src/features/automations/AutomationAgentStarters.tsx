import {useCallback, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentChip} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
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
    const t = useT(automationsScreensCatalog)
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
    if (query.isError)
        return <LoadError title={t("automations.screens.startersLoadFailed")} onRetry={retry} />
    if (agents.length === 0) return <FeatureTemplateStarters guideKey="automations" base={base} />

    return (
        <FeatureSection
            title={t("automations.screens.startersTitle")}
            link={{href: `${base}/agents`, label: t("automations.screens.viewAllAgents")}}
        >
            <div className="grid gap-3 @2xl:grid-cols-3">
                {agents.map((agent) => (
                    <FeatureActionCard
                        key={agent.id}
                        media={<AgentChip workflowId={agent.id} box="size-[30px]" glyph={16} />}
                        title={agent.name || agent.slug || t("automations.screens.untitledAgent")}
                        description={agent.description || t("automations.screens.noDescription")}
                        actionLabel={t("automations.screens.setUpAutomation")}
                        meta={t("automations.screens.agentMeta")}
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

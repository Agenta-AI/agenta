import {LoadError} from "@agenta/ui/components/presentational"
import Link from "next/link"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {EvaluationRunsTable} from "../evaluations/list/EvaluationRunsTable"
import {EvaluationsEmpty} from "../evaluations/list/states/EvaluationsEmpty"
import {useRunRowActions} from "../evaluations/list/useRunRowActions"

import {SectionTitle} from "./states/SectionTitle"
import {useLatestAppRuns, type AppRunKind} from "./useLatestAppRuns"

const TITLES: Record<AppRunKind, string> = {
    auto: "Auto Evaluations",
    human: "Human Evaluations",
}

/**
 * The five newest runs of one kind for the app, in the runs list table without its Application
 * column. With no runs it shows the kind's empty state and no start button: the overview does
 * not create evaluations.
 */
export const AppEvaluationsSection = ({
    projectId,
    appId,
    base,
    kind,
}: {
    projectId: string
    appId: string
    base: string
    kind: AppRunKind
}) => {
    const runs = useLatestAppRuns({projectId, appId, kind})
    const actions = useRunRowActions({projectId, base})
    const evaluationsEnabled = useDeveloperViewEnabled("evaluations") === true
    const title = TITLES[kind]

    return (
        <section aria-label={title}>
            <SectionTitle
                title={
                    evaluationsEnabled ? (
                        <Link
                            href={`${base}/evaluations?app=${encodeURIComponent(appId)}&kind=${kind}`}
                            prefetch={false}
                            className="text-foreground no-underline hover:underline"
                        >
                            {title} →
                        </Link>
                    ) : (
                        title
                    )
                }
            />
            {runs.isError && runs.data === undefined ? (
                <LoadError
                    framed
                    title="Could not load evaluations"
                    onRetry={() => void runs.refetch()}
                />
            ) : (
                <EvaluationRunsTable
                    runs={runs.data ?? []}
                    isLoading={runs.isPending}
                    scope="app"
                    actions={actions}
                    empty={<EvaluationsEmpty kind={kind} />}
                />
            )}
            {actions.modal}
        </section>
    )
}

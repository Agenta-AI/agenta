import {useState} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {EvaluationRunsTable} from "../evaluations/list/EvaluationRunsTable"
import {EvaluationsEmpty} from "../evaluations/list/states/EvaluationsEmpty"
import {useRunRowActions} from "../evaluations/list/useRunRowActions"

import {SectionTitle} from "./states/SectionTitle"
import {useLatestAppRuns, type AppRunKind} from "./useLatestAppRuns"

// The wizard costs nothing until a reader starts an evaluation.
const NewEvaluationSheet = dynamic(
    () =>
        import("../evaluations/new/NewEvaluationSheet").then((module) => module.NewEvaluationSheet),
    {ssr: false},
)

const TITLES: Record<AppRunKind, string> = {
    auto: "Auto Evaluations",
    human: "Human Evaluations",
}

/**
 * The five newest runs of one kind for the app, in the runs list table without its Application
 * column. With no runs it shows the kind's empty state and no start button.
 *
 * Beta developer mode shows the runs as /w does: the kind's metric columns, the Application
 * column with the variant version, and a New evaluation button.
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
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const [creating, setCreating] = useState(false)

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
                action={
                    beta && actions.canEdit ? (
                        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                            <Plus aria-hidden size={14} />
                            New evaluation
                        </Button>
                    ) : null
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
                    kind={beta ? kind : undefined}
                    isLoading={runs.isPending}
                    scope={beta ? "project" : "app"}
                    actions={actions}
                    empty={<EvaluationsEmpty kind={kind} />}
                />
            )}
            {actions.modal}
            {creating ? (
                <NewEvaluationSheet
                    kind={kind}
                    projectId={projectId}
                    base={base}
                    appId={appId}
                    onClose={() => setCreating(false)}
                    onStarted={() => void runs.refetch()}
                />
            ) : null}
        </section>
    )
}

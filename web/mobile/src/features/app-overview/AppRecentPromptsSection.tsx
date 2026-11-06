import {useMemo, useState} from "react"

import {workflowLatestRevisionIdAtomFamily, type Workflow} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {CloudArrowUp} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import {useProjectPermission} from "../context/useProjectPermission"
import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {useRevisionParam} from "../revisions/useRevisionParam"
import {DeployRevisionDialog} from "../variants/DeployRevisionDialog"
import {VariantsEmpty} from "../variants/states/VariantsEmpty"
import {useAppRevisions, type AppRevisionRow} from "../variants/useAppRevisions"
import {useShownRevisionRow} from "../variants/useShownRevisionRow"
import {VariantsTable} from "../variants/VariantsTable"
import {toRevisionGroups} from "../variants/variantsView"

import {SectionTitle} from "./states/SectionTitle"

// The drawer and its config pane cost nothing until a reader opens a revision.
const RevisionDrawerHost = dynamic(
    () => import("../revisions/RevisionDrawerHost").then((module) => module.RevisionDrawerHost),
    {ssr: false},
)

export const RECENT_PROMPTS_COUNT = 5

/**
 * The five newest revisions of the app. A row opens the revision drawer. Nothing here deletes.
 * An evaluator is not deployed and has no Registry, so it gets neither Deploy nor the link.
 */
export const AppRecentPromptsSection = ({
    projectId,
    app,
    base,
    evaluator = false,
}: {
    projectId: string
    app: Workflow
    base: string
    evaluator?: boolean
}) => {
    const revisions = useAppRevisions({projectId, appId: app.id, search: ""})
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(app.id)) ?? null
    const canDeploy = useProjectPermission(projectId, "deploy_environments") && !evaluator
    const variantsEnabled = useDeveloperViewEnabled("variants") === true && !evaluator
    const [revisionId, setRevisionId] = useRevisionParam()
    const [deployRow, setDeployRow] = useState<AppRevisionRow | null>(null)

    const newest = useMemo(() => revisions.rows.slice(0, RECENT_PROMPTS_COUNT), [revisions.rows])
    const groups = useMemo(() => toRevisionGroups(newest, "revisions"), [newest])
    const shownRow = useShownRevisionRow({revisionId, appId: app.id, rows: revisions.rows})

    return (
        <section aria-label="Recent Prompts">
            <SectionTitle
                title="Recent Prompts"
                action={
                    variantsEnabled ? (
                        <Link
                            href={`${base}/variants?app=${encodeURIComponent(app.id)}`}
                            prefetch={false}
                            className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
                        >
                            View all prompts →
                        </Link>
                    ) : null
                }
            />
            {revisions.isError ? (
                <LoadError
                    framed
                    title="Could not load variants"
                    onRetry={() => void revisions.refetch()}
                />
            ) : (
                <VariantsTable
                    groups={groups}
                    isLoading={revisions.isPending}
                    latestRevisionId={latestRevisionId}
                    canDeploy={canDeploy}
                    canDelete={false}
                    onOpen={(row) => setRevisionId(row.revisionId)}
                    onDeploy={setDeployRow}
                    empty={<VariantsEmpty />}
                />
            )}
            {revisionId ? (
                <RevisionDrawerHost
                    kind="variant"
                    navigationIds={newest.map((row) => row.revisionId)}
                    actions={
                        canDeploy && shownRow ? (
                            <Button size="sm" onClick={() => setDeployRow(shownRow)}>
                                <CloudArrowUp aria-hidden size={14} />
                                Deploy
                            </Button>
                        ) : null
                    }
                />
            ) : null}
            {deployRow ? (
                <DeployRevisionDialog
                    key={deployRow.revisionId}
                    row={deployRow}
                    appId={app.id}
                    appSlug={app.slug ?? null}
                    onClose={() => setDeployRow(null)}
                />
            ) : null}
        </section>
    )
}

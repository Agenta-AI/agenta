import {useMemo, useState} from "react"

import {workflowLatestRevisionIdAtomFamily, type Workflow} from "@agenta/entities/workflow"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {CloudArrowUp, Rocket} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import {useProjectPermission} from "../context/useProjectPermission"
import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {playgroundHref} from "../playground/playgroundUrl"
import {DeployRevisionButton} from "../revisions/DeployRevisionButton"
import {OpenInPlaygroundButton} from "../revisions/OpenInPlaygroundButton"
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
// Beta developer mode only; everyone else keeps the read-only drawer.
const EditableRevisionDrawerHost = dynamic(
    () =>
        import("../revisions/EditableRevisionDrawerHost").then(
            (module) => module.EditableRevisionDrawerHost,
        ),
    {ssr: false},
)
const DeleteRevisionDialog = dynamic(
    () => import("../variants/DeleteRevisionDialog").then((module) => module.DeleteRevisionDialog),
    {ssr: false},
)

export const RECENT_PROMPTS_COUNT = 5

/**
 * The five newest revisions of the app. A row opens the revision drawer. Beta developer mode adds
 * what /w has: the Playground button, Open in Playground and Delete in the row menu, and the
 * editable drawer. An evaluator is not deployed and has no Registry, so it gets neither Deploy
 * nor the Registry link.
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
    const [deleteRow, setDeleteRow] = useState<AppRevisionRow | null>(null)
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const canDelete = useProjectPermission(projectId, "edit_workflows")
    const playgroundEnabled = useDeveloperViewEnabled("playground") === true
    const toPlayground =
        beta && playgroundEnabled
            ? (row: AppRevisionRow) => playgroundHref(base, app.id, [row.revisionId])
            : null

    const newest = useMemo(() => revisions.rows.slice(0, RECENT_PROMPTS_COUNT), [revisions.rows])
    const groups = useMemo(() => toRevisionGroups(newest, "revisions"), [newest])
    const shownRow = useShownRevisionRow({revisionId, appId: app.id, rows: revisions.rows})

    return (
        <section aria-label="Recent Prompts">
            <SectionTitle
                title="Recent Prompts"
                action={
                    <div className="flex shrink-0 items-center gap-3">
                        {variantsEnabled ? (
                            <Link
                                href={`${base}/variants?app=${encodeURIComponent(app.id)}`}
                                prefetch={false}
                                className="shrink-0 text-sm text-muted-foreground hover:text-foreground"
                            >
                                View all prompts →
                            </Link>
                        ) : null}
                        {beta && playgroundEnabled ? (
                            <Button asChild size="sm">
                                <Link href={playgroundHref(base, app.id)} prefetch={false}>
                                    <Rocket aria-hidden size={14} />
                                    Playground
                                </Link>
                            </Button>
                        ) : null}
                    </div>
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
                    canDelete={beta && canDelete}
                    playgroundHref={toPlayground}
                    onOpen={(row) => setRevisionId(row.revisionId)}
                    onDeploy={setDeployRow}
                    onDelete={beta ? setDeleteRow : undefined}
                    detailed={beta}
                    empty={<VariantsEmpty />}
                />
            )}
            {revisionId && beta ? (
                <EditableRevisionDrawerHost
                    projectId={projectId}
                    kind="variant"
                    navigationIds={newest.map((row) => row.revisionId)}
                    actions={
                        <>
                            {playgroundEnabled ? (
                                <OpenInPlaygroundButton
                                    href={playgroundHref(base, app.id, [revisionId])}
                                />
                            ) : null}
                            {canDeploy ? (
                                <DeployRevisionButton
                                    revisionId={revisionId}
                                    appId={app.id}
                                    appSlug={app.slug ?? null}
                                />
                            ) : null}
                        </>
                    }
                />
            ) : null}
            {revisionId && !beta ? (
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
            {deleteRow ? (
                <DeleteRevisionDialog
                    key={deleteRow.revisionId}
                    row={deleteRow}
                    projectId={projectId}
                    appId={app.id}
                    onClose={() => setDeleteRow(null)}
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

import {useState, type ReactNode} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {
    discardLocalServerDataAtom,
    queryWorkflowRevisionsByWorkflow,
    workflowDetailQueryAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Rocket, Trash} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useStore} from "jotai"
import dynamic from "next/dynamic"

import {useProjectPermissionState} from "../context/useProjectPermission"
import type {DialogRevision} from "../variants/DeployRevisionDialog"

import {RevisionMenu} from "./RevisionMenu"

// Each dialog loads when it is first opened, so the playground opens without them.
const CommitRevisionModal = dynamic(
    () => import("./CommitRevisionModal").then((m) => m.CommitRevisionModal),
    {ssr: false},
)
const DeployRevisionDialog = dynamic(
    () => import("../variants/DeployRevisionDialog").then((m) => m.DeployRevisionDialog),
    {ssr: false},
)
const DeleteRevisionDialog = dynamic(
    () => import("../variants/DeleteRevisionDialog").then((m) => m.DeleteRevisionDialog),
    {ssr: false},
)

type Open =
    | {kind: "commit"}
    | {kind: "deploy"; revision: DialogRevision}
    | {kind: "delete"; revision: DialogRevision}

/** A disabled button shows no tooltip of its own, so the tooltip wraps it. */
const WithTooltip = ({
    title,
    className,
    children,
}: {
    title: string | null
    className?: string
    children: ReactNode
}) =>
    title ? (
        <SimpleTooltip title={title} side="bottom">
            <span className={cn("inline-flex", className)}>{children}</span>
        </SimpleTooltip>
    ) : (
        <>{children}</>
    )

/**
 * The buttons on the bar of one revision: Deploy, Commit and the menu. A local draft has Commit
 * and a trash button instead. The reader sees every verb; one the role may not use is disabled
 * and says why, and the server stays the judge.
 *
 * It reads what a click needs from the store at click time, so typing in the config does not
 * render it again.
 */
export const RevisionActions = ({
    projectId,
    appId,
    revisionId,
    onCommitted,
}: {
    projectId: string
    appId: string
    revisionId: string
    /** A commit made a new revision: show it. */
    onCommitted: (revisionId: string) => void
}) => {
    const store = useStore()
    const queryClient = useQueryClient()
    const [open, setOpen] = useState<Open | null>(null)
    const edit = useProjectPermissionState(projectId, "edit_workflows")
    const deploy = useProjectPermissionState(projectId, "deploy_environments")
    const canEdit = edit.allowed
    const canDeploy = deploy.allowed
    const app = useAtomValue(workflowDetailQueryAtomFamily(appId))
    const query = useAtomValue(workflowMolecule.selectors.query(revisionId))
    const dirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))
    const ephemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(revisionId))
    const isLocalDraft = isLocalDraftId(revisionId)
    const loading = query.isPending && !isLocalDraft

    // No reason while the check is still running: the answer may be yes.
    const commitReason =
        canEdit || edit.pending ? null : "You don't have permission to commit changes."
    const deployReason = canDeploy || deploy.pending ? null : "You don't have permission to deploy."
    const deleteReason = canEdit || edit.pending ? null : "You don't have permission to delete."

    const shownRevision = (): DialogRevision => {
        const data = store.get(workflowMolecule.selectors.data(revisionId))
        return {
            revisionId,
            version: data?.version ?? 0,
            variantId: data?.workflow_variant_id ?? "",
            variantSlug: data?.workflow_variant_slug ?? null,
            variantName: store.get(workflowMolecule.selectors.variantLabel(revisionId)) ?? "",
        }
    }

    const discard = () => {
        try {
            store.set(workflowMolecule.actions.discard, revisionId)
            message.success("Draft changes discarded")
        } catch (error) {
            console.error("Discard draft failed", error)
            message.error("Failed to discard draft changes")
        }
    }

    const copyConfig = async () => {
        const config = store.get(workflowMolecule.selectors.configuration(revisionId))
        if (!config) {
            message.warning("No raw configuration available to copy")
            return
        }
        const copied = await copyToClipboard(JSON.stringify(config, null, 2))
        if (copied) message.success("Raw configuration copied to clipboard")
        else message.error("Failed to copy raw configuration")
    }

    // The deleted revision leaves the screen. The server names the newest revision left; it also
    // becomes the app's cached latest revision, which the header and the next visit read.
    const afterDelete = async (deletedId: string) => {
        store.set(workflowMolecule.actions.discard, deletedId)
        try {
            const page = await queryWorkflowRevisionsByWorkflow(appId, projectId, undefined, {
                limit: 1,
                order: "descending",
            })
            const latest = page.workflow_revisions[0] ?? null
            queryClient.setQueryData(["workflows", "latestRevision", appId, projectId], latest)
            if (latest) {
                store.set(playgroundController.actions.switchEntity, {
                    currentEntityId: deletedId,
                    newEntityId: latest.id,
                })
            }
        } catch (error) {
            console.error("Loading the newest revision failed", error)
        }
        queryClient.removeQueries({
            predicate: ({queryKey: [scope, kind, id]}) =>
                scope === "workflows" && kind === "revision" && id === deletedId,
        })
    }

    const discardLocalDraft = () => {
        store.set(playgroundController.actions.removeEntity, revisionId)
        store.set(discardLocalServerDataAtom, revisionId)
    }

    const commitButton = (
        <WithTooltip title={commitReason}>
            <Button
                size="sm"
                disabled={loading || !canEdit || !(dirty || ephemeral)}
                onClick={() => setOpen({kind: "commit"})}
            >
                {ephemeral ? "Create" : "Commit"}
            </Button>
        </WithTooltip>
    )

    return (
        <>
            {isLocalDraft ? (
                <>
                    {commitButton}
                    {ephemeral ? null : (
                        <SimpleTooltip title="Discard draft" side="bottom">
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Discard draft"
                                onClick={discardLocalDraft}
                            >
                                <Trash aria-hidden />
                            </Button>
                        </SimpleTooltip>
                    )}
                </>
            ) : (
                <>
                    <WithTooltip title={deployReason ?? "Deploy"} className="max-sm:hidden">
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Deploy"
                            disabled={loading || !canDeploy}
                            onClick={() => setOpen({kind: "deploy", revision: shownRevision()})}
                        >
                            <Rocket aria-hidden />
                        </Button>
                    </WithTooltip>
                    {commitButton}
                    <RevisionMenu
                        dirty={dirty}
                        canDeploy={canDeploy && !loading}
                        canDelete={canEdit && !loading}
                        deployHint={deployReason}
                        deleteHint={deleteReason}
                        onCopyConfig={() => void copyConfig()}
                        onRevert={discard}
                        onDeploy={() => setOpen({kind: "deploy", revision: shownRevision()})}
                        onDelete={() => setOpen({kind: "delete", revision: shownRevision()})}
                    />
                </>
            )}

            {open?.kind === "commit" ? (
                <CommitRevisionModal
                    revisionId={revisionId}
                    appId={appId}
                    appSlug={app.data?.slug ?? null}
                    canDeploy={canDeploy}
                    onClose={() => setOpen(null)}
                    onCommitted={onCommitted}
                />
            ) : null}
            {open?.kind === "deploy" ? (
                <DeployRevisionDialog
                    row={open.revision}
                    appId={appId}
                    appSlug={app.data?.slug ?? null}
                    onClose={() => setOpen(null)}
                />
            ) : null}
            {open?.kind === "delete" ? (
                <DeleteRevisionDialog
                    row={open.revision}
                    projectId={projectId}
                    appId={appId}
                    onClose={() => setOpen(null)}
                    onDeleted={afterDelete}
                />
            ) : null}
        </>
    )
}

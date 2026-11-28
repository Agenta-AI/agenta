import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {
    EditableRevisionDrawer,
    type EditableRevisionDrawerKind,
} from "@agenta/playground-ui/panels/drawer"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {useProjectPermission} from "../context/useProjectPermission"
import {PlaygroundFocusDrawerHost} from "../playground/PlaygroundFocusDrawerHost"
import {PlaygroundRunPane} from "../playground/PlaygroundRunPane"
import {usePlaygroundLeaveGuard} from "../playground/usePlaygroundLeaveGuard"

import {useRevisionParam} from "./useRevisionParam"

// The tools section of a prompt opens the tool catalog; it loads when first opened.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)
// The wand on a prompt section opens it; it loads when first opened.
const RefinePromptDialog = dynamic(
    () => import("@agenta/playground-ui/panels/refine").then((m) => m.RefinePromptDialog),
    {ssr: false},
)

/**
 * The editable revision drawer bound to the URL, for beta developer mode: edit the config,
 * Commit, Test, Open in playground. A page must load this file with `next/dynamic` and
 * `{ssr: false}`, and render it only once `revisionId` is set, so the drawer code costs nothing
 * until a user opens a revision. The page must have no playground of its own.
 */
export const EditableRevisionDrawerHost = ({
    projectId,
    kind,
    navigationIds,
    actions,
}: {
    projectId: string
    kind: EditableRevisionDrawerKind
    navigationIds?: readonly string[]
    /** Header buttons: Open in playground, Deploy, Revert. */
    actions?: ReactNode
}) => {
    const [revisionId, setRevisionId] = useRevisionParam()
    const queryClient = useQueryClient()
    const canCommit = useProjectPermission(projectId, "edit_workflows")
    const canDeploy = useProjectPermission(projectId, "deploy_environments")
    // A link out of the page (Open in playground) asks before unsaved edits are lost.
    const leaveDialog = usePlaygroundLeaveGuard()
    const t = useT(commonCatalog)
    const [refine, setRefine] = useState<{revisionId: string; promptKey: string} | null>(null)

    return (
        <DrillInBridgeProvider projectId={projectId}>
            <EditableRevisionDrawer
                revisionId={revisionId}
                kind={kind}
                navigationIds={navigationIds}
                onNavigate={setRevisionId}
                onClose={() => setRevisionId(null)}
                actions={actions}
                canCommit={canCommit}
                canDeploy={canDeploy}
                renderRuns={(id) => <PlaygroundRunPane revisionId={id} />}
                onRefinePrompt={(id, promptKey) => setRefine({revisionId: id, promptKey})}
                onCommitted={(_from, newRevisionId) => {
                    // The registry lists the new revision; "Commit and deploy" also moves the
                    // environment cards and the deployment history.
                    void queryClient.invalidateQueries({queryKey: ["workflows", "app-revisions"]})
                    void queryClient.invalidateQueries({queryKey: ["environments"]})
                    setRevisionId(newRevisionId)
                }}
            />
            <CatalogDrawer />
            {refine ? (
                <RefinePromptDialog
                    key={`${refine.revisionId}:${refine.promptKey}`}
                    revisionId={refine.revisionId}
                    promptKey={refine.promptKey}
                    onClose={() => setRefine(null)}
                />
            ) : null}
            <PlaygroundFocusDrawerHost />
            <AlertDialog
                open={Boolean(leaveDialog.request)}
                onOpenChange={(next) => {
                    if (!next && !leaveDialog.pending) leaveDialog.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{leaveDialog.request?.title ?? ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {leaveDialog.request?.message ?? ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {leaveDialog.error ? (
                        <p className="m-0 text-body text-destructive">{leaveDialog.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={leaveDialog.close}
                                disabled={leaveDialog.pending}
                            >
                                {leaveDialog.request?.cancelText ?? t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant={
                                    leaveDialog.request?.danger === false
                                        ? "default"
                                        : "destructive"
                                }
                                disabled={leaveDialog.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void leaveDialog.runConfirm()
                                }}
                            >
                                {leaveDialog.pending
                                    ? t("common.working")
                                    : (leaveDialog.request?.okText ?? t("common.confirm"))}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </DrillInBridgeProvider>
    )
}

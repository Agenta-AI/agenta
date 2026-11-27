import {useCallback, useEffect} from "react"

import {preloadEditorPlugins} from "@agenta/editor/editor"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {playgroundController} from "@agenta/playground"
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
import {useStore} from "jotai"
import {useRouter} from "next/router"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"

import {agentEntryHref} from "../agents/agentEntry"

import {PlaygroundWorkspace} from "./PlaygroundWorkspace"
import {PlaygroundLoadError} from "./states/PlaygroundLoadError"
import {PlaygroundSkeleton} from "./states/PlaygroundSkeleton"
import {usePlaygroundLeaveGuard} from "./usePlaygroundLeaveGuard"
import {usePlaygroundSelection} from "./usePlaygroundSelection"

/**
 * The prompt playground for one app: the config of the selected revision beside its runs.
 *
 * An agent app goes to the agent page, which has its own playground. An evaluator app shows
 * "not found": evaluators open in the evaluator playground.
 */
export const AppPlaygroundScreen = ({
    workspaceId,
    projectId,
    appId,
}: {
    workspaceId: string
    projectId: string
    appId: string
}) => {
    const router = useRouter()
    const store = useStore()
    const selection = usePlaygroundSelection({appId})
    const leaveDialog = usePlaygroundLeaveGuard()
    const t = useT(commonCatalog)
    const {status, appKind, primaryRevisionId, revisionIds} = selection

    useEffect(() => {
        preloadEditorPlugins()
    }, [])

    useEffect(() => {
        if (appKind !== "agent") return
        void router.replace(agentEntryHref(`/w/${workspaceId}/p/${projectId}`, appId))
    }, [appId, appKind, projectId, router, workspaceId])

    // A commit makes a new revision: it takes the place of the revision it was made from.
    const followCommit = useCallback(
        (fromRevisionId: string, toRevisionId: string) => {
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: fromRevisionId,
                newEntityId: toRevisionId,
            })
        },
        [store],
    )

    if (status === "not-found" || appKind === "evaluator") return <PageNotFound />

    return (
        <>
            <PageTitle title="Playground" context={selection.appName ?? undefined} />
            {status === "error" ? (
                <PlaygroundLoadError onRetry={selection.retry} />
            ) : appKind !== "prompt" || !primaryRevisionId ? (
                <PlaygroundSkeleton />
            ) : (
                <PlaygroundWorkspace
                    workspaceId={workspaceId}
                    projectId={projectId}
                    appId={appId}
                    appName={selection.appName}
                    revisionIds={revisionIds}
                    onWorkflowRevisionCommitted={followCommit}
                />
            )}
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
        </>
    )
}

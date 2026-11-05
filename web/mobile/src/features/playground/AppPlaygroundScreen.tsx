import {useCallback, useEffect} from "react"

import {playgroundController} from "@agenta/playground"
import {preloadEditorPlugins} from "@agenta/ui/editor"
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
            {leaveDialog}
        </>
    )
}

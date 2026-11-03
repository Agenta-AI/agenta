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
 * "not found" until the evaluator playground lands.
 */
export const PlaygroundScreen = ({
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
    const {status, appKind, primaryRevisionId} = selection

    useEffect(() => {
        preloadEditorPlugins()
    }, [])

    useEffect(() => {
        if (appKind !== "agent") return
        void router.replace(agentEntryHref(`/w/${workspaceId}/p/${projectId}`, appId))
    }, [appId, appKind, projectId, router, workspaceId])

    // A commit makes a new revision: the playground follows it.
    const followCommit = useCallback(
        (revisionId: string) => {
            if (!primaryRevisionId) return
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: primaryRevisionId,
                newEntityId: revisionId,
            })
        },
        [primaryRevisionId, store],
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
                    appName={selection.appName}
                    revisionId={primaryRevisionId}
                    onWorkflowRevisionCommitted={followCommit}
                />
            )}
            {leaveDialog}
        </>
    )
}

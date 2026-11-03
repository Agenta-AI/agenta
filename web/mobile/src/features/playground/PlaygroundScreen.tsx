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
import {usePlaygroundSession} from "./usePlaygroundSession"

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
    const session = usePlaygroundSession({appId})
    const leaveDialog = usePlaygroundLeaveGuard()
    const {status, primaryId} = session

    useEffect(() => {
        preloadEditorPlugins()
    }, [])

    useEffect(() => {
        if (status !== "agent") return
        void router.replace(agentEntryHref(`/w/${workspaceId}/p/${projectId}`, appId))
    }, [appId, projectId, router, status, workspaceId])

    // A commit makes a new revision: the playground follows it.
    const followCommit = useCallback(
        (revisionId: string) => {
            if (!primaryId) return
            store.set(playgroundController.actions.switchEntity, {
                currentEntityId: primaryId,
                newEntityId: revisionId,
            })
        },
        [primaryId, store],
    )

    if (status === "not-found" || status === "evaluator") return <PageNotFound />

    return (
        <>
            <PageTitle title="Playground" context={session.appName ?? undefined} />
            {status === "error" ? (
                <PlaygroundLoadError onRetry={session.retry} />
            ) : status !== "ready" || !primaryId ? (
                <PlaygroundSkeleton />
            ) : (
                <PlaygroundWorkspace
                    workspaceId={workspaceId}
                    projectId={projectId}
                    appName={session.appName}
                    revisionId={primaryId}
                    onRevisionCommitted={followCommit}
                />
            )}
            {leaveDialog}
        </>
    )
}

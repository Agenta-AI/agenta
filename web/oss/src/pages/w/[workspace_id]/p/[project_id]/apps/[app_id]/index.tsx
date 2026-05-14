import {useEffect} from "react"

import {appWorkflowsListQueryAtom} from "@agenta/entities/workflow"
import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import WorkflowNotFound from "@/oss/components/WorkflowNotFound"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

const ensureString = (value: string | string[] | undefined) => {
    if (!value) return null
    return Array.isArray(value) ? value[0] : value
}

/**
 * `/apps/[app_id]/` → `/apps/[app_id]/{overview|playground}` redirect.
 *
 * Fast-path (eng review T2): if the app query already has the workflow
 * cached synchronously AND it's an app workflow, redirect to `/overview`
 * immediately — no skeleton flicker for the 99% case. Apps used to redirect
 * instantly via the previous implementation; this preserves that behavior.
 *
 * Slow-path: cold-load, evaluator workflow, snippet, or not-found cases all
 * go through `currentWorkflowContextAtom` which waits for both queries to
 * settle. Evaluators get `/playground` as default (overview is disabled for
 * them per Phase 2). Not-found renders `<WorkflowNotFound />` instead of
 * looping the spinner.
 */
const AppOverviewRedirect = () => {
    const router = useRouter()
    const ctx = useAtomValue(currentWorkflowContextAtom)
    const appsQuery = useAtomValue(appWorkflowsListQueryAtom)

    const workspaceId = ensureString(router.query.workspace_id)
    const projectId = ensureString(router.query.project_id)
    const appId = ensureString(router.query.app_id)

    // Synchronous fast-path: read the app query cache without waiting.
    // If the workflow is already there AND it's an app, redirect now.
    const synchronousAppHit = (() => {
        if (!appId || !appsQuery.data?.refs) return null
        const refs = appsQuery.data.refs as {id: string; flags?: {is_evaluator?: boolean}}[]
        const match = refs.find((w) => w.id === appId)
        if (!match) return null
        if (match.flags?.is_evaluator) return null
        return match
    })()

    useEffect(() => {
        if (!router.isReady) return
        if (!workspaceId || !projectId || !appId) {
            void router.replace("/404")
            return
        }

        // Fast-path: synchronous app hit → /overview right now.
        if (synchronousAppHit) {
            const destination = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
                projectId,
            )}/apps/${encodeURIComponent(appId)}/overview`
            if (router.asPath !== destination) {
                void router.replace(destination)
            }
            return
        }

        // Slow-path: wait for the workflow to resolve (covers evaluator,
        // snippet, and cold-load).
        if (ctx.isResolving) return
        if (ctx.isError) return // page renders skeleton; avoid a wrong-redirect on error
        if (ctx.isNotFound) return // <WorkflowNotFound /> renders below

        // Pick destination based on workflow kind.
        const target = ctx.workflowKind === "evaluator" ? "playground" : "overview"
        const destination = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
            projectId,
        )}/apps/${encodeURIComponent(appId)}/${target}`
        if (router.asPath !== destination) {
            void router.replace(destination)
        }
    }, [
        router.isReady,
        router.asPath,
        workspaceId,
        projectId,
        appId,
        synchronousAppHit,
        ctx.isResolving,
        ctx.isError,
        ctx.isNotFound,
        ctx.workflowKind,
        router,
    ])

    if (ctx.isNotFound) {
        return <WorkflowNotFound workflowId={ctx.workflowId} routeSegment="overview" />
    }

    return (
        <section className="flex h-screen w-full items-center justify-center">
            <Spin spinning={true} />
        </section>
    )
}

export default AppOverviewRedirect

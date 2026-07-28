import {useEffect} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useQueryClient} from "@tanstack/react-query"
import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import WorkflowNotFound from "@/oss/components/WorkflowNotFound"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

interface AppsListCache {
    refs?: {id: string; flags?: {is_evaluator?: boolean}}[]
}

const ensureString = (value: string | string[] | undefined) => {
    if (!value) return null
    return Array.isArray(value) ? value[0] : value
}

/**
 * `/apps/[app_id]/` → `/apps/[app_id]/playground` redirect.
 *
 * Fast-path (eng review T2): if the app query already has the workflow
 * cached synchronously AND it's an app workflow, redirect to `/playground`
 * immediately — no skeleton flicker for the 99% case. Apps used to redirect
 * instantly via the previous implementation; this preserves that behavior.
 *
 * Slow-path: cold-load, evaluator workflow, snippet, or not-found cases all
 * go through `currentWorkflowContextAtom` which waits for both queries to
 * settle. Playground is the default surface for every workflow kind. Not-found
 * renders `<WorkflowNotFound />` instead of looping the spinner.
 */
const AppOverviewRedirect = () => {
    const router = useRouter()
    const ctx = useAtomValue(currentWorkflowContextAtom)
    // Atom projectId matches the apps-list query key (which uses workflowProjectIdAtom).
    const cacheProjectId = useAtomValue(projectIdAtom)
    const queryClient = useQueryClient()

    const workspaceId = ensureString(router.query.workspace_id)
    const projectId = ensureString(router.query.project_id)
    const appId = ensureString(router.query.app_id)

    // Synchronous fast-path: PEEK the apps-list cache without SUBSCRIBING. A
    // `useAtomValue(appWorkflowsListQueryAtom)` here would trigger the full apps
    // list fetch on every `/apps/[id]` navigation — but on a cold load it isn't
    // cached anyway (so the fetch is wasted) and the slow-path below resolves the
    // workflow by id via `ctx`. `getQueryData` reads the cache only if it was
    // already warmed elsewhere (e.g. coming from app-management), giving the
    // flicker-free fast redirect without ever initiating the request.
    const synchronousAppHit = (() => {
        if (!appId) return null
        const cached = queryClient.getQueryData<AppsListCache>([
            "workflows",
            "apps",
            "list",
            cacheProjectId,
        ])
        const match = cached?.refs?.find((w) => w.id === appId)
        if (!match || match.flags?.is_evaluator) return null
        return match
    })()

    useEffect(() => {
        if (!router.isReady) return
        if (!workspaceId || !projectId || !appId) {
            void router.replace("/404")
            return
        }

        // Fast-path: synchronous app hit → /playground right now.
        if (synchronousAppHit) {
            const destination = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
                projectId,
            )}/apps/${encodeURIComponent(appId)}/playground`
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

        // Playground is the default surface for every workflow kind.
        const destination = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(
            projectId,
        )}/apps/${encodeURIComponent(appId)}/playground`
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

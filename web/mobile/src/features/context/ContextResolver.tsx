import {useEffect, useMemo, useState} from "react"

import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {
    fetchProjects,
    projectHomeUrl,
    readDesktopLastUsed,
    readLastContext,
    type LastContext,
} from "@/lib/context"

import {selectContextTarget} from "./contextTarget"
import {groupByWorkspace, type WorkspaceGroup} from "./workspaceGroups"

interface ContextResolverProps {
    /**
     * Confine resolution to the workspace the URL names (`/w/:workspace_id`, `/w/:id/p`), so
     * a link into a workspace lands in THAT workspace rather than the remembered one. Omitted
     * on `/m/` and `/m/w`, which resolve across the whole tree.
     */
    workspaceId?: string
}

/**
 * `/m/` root flow: resolve a project (remembered → desktop continuity → first) and forward to
 * its home. There is no picker page — switching lives in the drawer, exactly like the desktop
 * rail. This route only ever shows "Loading", an error, or leaves.
 *
 * Also the body of every `/w/...` index gate — the desktop's `WorkspaceSelection` /
 * `WorkspaceRedirect` / `WorkspaceProjectRedirect` trio, collapsed into one resolver because
 * mobile answers all three questions from the same project list.
 */
export const ContextResolver = ({workspaceId}: ContextResolverProps = {}) => {
    const router = useRouter()
    // useState initializer: read once, client-only (SSR renders the loading branch).
    const [stored] = useState<LastContext | null>(() =>
        typeof window === "undefined" ? null : readLastContext(),
    )

    // Always fetched (the shared key every screen uses): a stored pair still forwards on the
    // first render, but once the tree answers we can tell a stale shortcut from a live one.
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const result = query.data

    const groups = useMemo<WorkspaceGroup[]>(
        () => (result?.kind === "ok" ? groupByWorkspace(result.projects) : []),
        [result],
    )

    const target = useMemo<LastContext | null>(
        () =>
            selectContextTarget({
                ready: router.isReady,
                shortcut: stored,
                groups,
                groupsLoaded: result?.kind === "ok",
                desktopLastUsed: readDesktopLastUsed(),
                workspaceId,
            }),
        [router.isReady, stored, groups, result, workspaceId],
    )

    useEffect(() => {
        if (!target?.projectId) return
        const next = projectHomeUrl(target)
        // A gate that forwards to itself would loop; nothing here ever resolves to its own
        // path, but the guard keeps that true if a route is added under a project home.
        if (router.asPath.split("?")[0] === next) return
        void router.replace(next)
    }, [target])

    // Signed out is not a screen on a phone — the auth page is, and AuthGate routes there
    // from wherever the user landed (this page redirects away too fast to be that gate).

    let body
    if (result?.kind === "error" || (result?.kind === "ok" && groups.length === 0)) {
        body = (
            <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-muted-foreground text-xs">
                    {result?.kind === "ok" ? "No projects found." : "Something went wrong."}
                </p>
                <button
                    type="button"
                    className="border-border min-h-11 rounded-md border px-3 py-2 text-xs"
                    onClick={() => void query.refetch()}
                >
                    Retry
                </button>
            </div>
        )
    } else {
        body = <p className="text-muted-foreground grow p-6 text-center text-xs">Loading…</p>
    }

    return (
        <>
            <PageTitle />
            <ScreenScaffold>{body}</ScreenScaffold>
        </>
    )
}

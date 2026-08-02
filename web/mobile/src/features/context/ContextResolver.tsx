import {useEffect, useMemo, useState} from "react"

import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {ScreenScaffold} from "@/components/ScreenScaffold"
import {fetchProjects, readDesktopLastUsed, readLastContext, type LastContext} from "@/lib/context"

import {selectContextTarget} from "./contextTarget"
import {SignedOutNotice} from "./states/SignedOutNotice"
import {WorkspaceProjectList, type WorkspaceGroup} from "./WorkspaceProjectList"

const sessionsUrl = ({workspaceId, projectId}: LastContext) =>
    `/w/${workspaceId}/p/${projectId}/sessions`

/**
 * `/m/` root flow: last-context → auto-forward, else fetch projects and pick.
 *
 * `?switch=1` suppresses every auto-forward so the picker is reachable from inside the app —
 * without it a stored context makes this route un-viewable and the workspace unswitchable.
 */
export const ContextResolver = () => {
    const router = useRouter()
    // useState initializer: read once, client-only (SSR renders the loading branch).
    const [stored] = useState<LastContext | null>(() =>
        typeof window === "undefined" ? null : readLastContext(),
    )
    const switching = router.isReady && router.query.switch !== undefined
    const shortcut = switching ? null : stored

    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        enabled: !shortcut,
        staleTime: 30_000,
    })
    const result = query.data

    const groups = useMemo<WorkspaceGroup[]>(() => {
        if (result?.kind !== "ok") return []
        const byWorkspace = new Map<string, WorkspaceGroup>()
        for (const project of result.projects) {
            if (!project.workspace_id) continue
            const group = byWorkspace.get(project.workspace_id) ?? {
                workspaceId: project.workspace_id,
                workspaceName: project.workspace_name ?? "Workspace",
                projects: [],
            }
            group.projects.push(project)
            byWorkspace.set(project.workspace_id, group)
        }
        return [...byWorkspace.values()]
    }, [result])

    const target = useMemo<LastContext | null>(
        () =>
            selectContextTarget({
                ready: router.isReady,
                switching,
                shortcut,
                groups,
                desktopLastUsed: readDesktopLastUsed(),
            }),
        [router.isReady, switching, shortcut, groups],
    )

    useEffect(() => {
        if (target) void router.replace(sessionsUrl(target))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target])

    let body
    // Pinned above the scroller — only the picker branch earns a title.
    let header
    if (target || (!shortcut && query.isPending)) {
        body = <p className="text-muted-foreground grow p-6 text-center text-xs">Loading…</p>
    } else if (result?.kind === "unauthenticated") {
        body = <SignedOutNotice />
    } else if (result?.kind === "ok" && groups.length > 0) {
        header = (
            <h1 className="border-border shrink-0 border-b p-4 text-xs font-semibold">
                Choose a project
            </h1>
        )
        body = <WorkspaceProjectList groups={groups} />
    } else {
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
    }

    return <ScreenScaffold header={header}>{body}</ScreenScaffold>
}

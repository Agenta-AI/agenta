import {useEffect, useMemo, useState} from "react"

import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects, readDesktopLastUsed, readLastContext, type LastContext} from "@/lib/context"

import {SignedOutNotice} from "./states/SignedOutNotice"
import {WorkspaceProjectList, type WorkspaceGroup} from "./WorkspaceProjectList"

const sessionsUrl = ({workspaceId, projectId}: LastContext) =>
    `/w/${workspaceId}/p/${projectId}/sessions`

/** `/m/` root flow: last-context → auto-forward, else fetch projects and pick. */
export const ContextResolver = () => {
    const router = useRouter()
    // useState initializer: read once, client-only (SSR renders the loading branch).
    const [stored] = useState<LastContext | null>(() =>
        typeof window === "undefined" ? null : readLastContext(),
    )

    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        enabled: !stored,
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

    const target = useMemo<LastContext | null>(() => {
        if (stored) return stored
        if (result?.kind !== "ok" || groups.length === 0) return null
        if (groups.length === 1 && groups[0].projects.length === 1) {
            return {workspaceId: groups[0].workspaceId, projectId: groups[0].projects[0].project_id}
        }
        // Desktop continuity: forward to the desktop's last-used pair when it
        // still exists in the fetched tree.
        const desktopLastUsed = readDesktopLastUsed()
        for (const group of groups) {
            const projectId = desktopLastUsed[group.workspaceId]
            if (projectId && group.projects.some((p) => p.project_id === projectId)) {
                return {workspaceId: group.workspaceId, projectId}
            }
        }
        return null
    }, [stored, result, groups])

    useEffect(() => {
        if (target) void router.replace(sessionsUrl(target))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target])

    let body
    if (target || (!stored && query.isPending)) {
        body = <p className="text-muted-foreground grow p-6 text-center text-xs">Loading…</p>
    } else if (result?.kind === "unauthenticated") {
        body = <SignedOutNotice />
    } else if (result?.kind === "ok" && groups.length > 0) {
        body = <WorkspaceProjectList groups={groups} />
    } else {
        body = (
            <div className="flex grow flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-muted-foreground text-xs">
                    {result?.kind === "ok" ? "No projects found." : "Something went wrong."}
                </p>
                <button
                    type="button"
                    className="border-border rounded-md border px-3 py-2 text-xs"
                    onClick={() => void query.refetch()}
                >
                    Retry
                </button>
            </div>
        )
    }

    return (
        <div className="bg-background text-foreground flex min-h-dvh flex-col">
            {body}
            {/* WP5 gate escape hatch: plain <a> (next/link would prefix /m) to a
                desktop URL; ?view=desktop sets the agenta-mobile-optout cookie. */}
            <footer className="pb-8 text-center">
                <a
                    href="/w?view=desktop"
                    className="text-muted-foreground text-xs underline underline-offset-4"
                >
                    View desktop site
                </a>
            </footer>
        </div>
    )
}

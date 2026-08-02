import {useQuery} from "@tanstack/react-query"
import {ChevronsUpDown} from "lucide-react"
import Link from "next/link"

import {fetchProjects} from "@/lib/context"

/**
 * Where you are, and the way out: workspace / project for the current route, tapping through to
 * the root picker with `?switch=1` (which suppresses its auto-forward).
 *
 * Shares the root picker's query key and staleTime, so arriving here after the picker costs no
 * request. Names are best-effort — the control still routes to the picker while they resolve.
 */
export const ProjectSwitcher = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const query = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })

    const current =
        query.data?.kind === "ok"
            ? query.data.projects.find(
                  (p) => p.project_id === projectId && p.workspace_id === workspaceId,
              )
            : undefined

    return (
        <Link
            href="/?switch=1"
            className="text-muted-foreground -m-1 flex min-h-11 items-center gap-1.5 p-1 text-xs"
        >
            <span className="truncate">
                {current ? `${current.workspace_name ?? "Workspace"} / ` : ""}
                <span className="text-foreground">{current?.project_name ?? "Switch project"}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
        </Link>
    )
}

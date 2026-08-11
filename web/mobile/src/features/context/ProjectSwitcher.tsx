import {ChevronsUpDown} from "lucide-react"
import Link from "next/link"

import {useCurrentProject} from "./useCurrentProject"

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
    const current = useCurrentProject(workspaceId, projectId)

    return (
        <Link
            href="/?switch=1"
            // Compact row, full-size touch target: `after` supplies the 44px without the height.
            className="text-muted-foreground relative flex items-center gap-1.5 self-start py-0.5 text-xs after:absolute after:-inset-x-2 after:-inset-y-2.5 after:content-['']"
        >
            <span className="truncate">
                {current ? `${current.workspace_name ?? "Workspace"} / ` : ""}
                <span className="text-foreground">{current?.project_name ?? "Switch project"}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
        </Link>
    )
}

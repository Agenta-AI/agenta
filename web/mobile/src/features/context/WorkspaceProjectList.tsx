import {useState} from "react"

import {Building2} from "lucide-react"
import {useRouter} from "next/router"

import type {MobileProject} from "@/lib/context"

export interface WorkspaceGroup {
    workspaceId: string
    workspaceName: string
    projects: MobileProject[]
}

/**
 * Project picker, scoped to one workspace at a time.
 *
 * With several workspaces the row of chips IS the workspace selector; with one there is nothing
 * to select, so the same line degrades to a label naming the workspace you are in (the default
 * workspace is called "Default", which reads as a duplicate of a project by that name unless
 * it is labelled).
 */
export const WorkspaceProjectList = ({groups}: {groups: WorkspaceGroup[]}) => {
    const router = useRouter()
    const [selectedId, setSelectedId] = useState(() => groups[0]?.workspaceId ?? "")
    // Fall back rather than track `groups` in state: a refetch can drop the selected workspace.
    const selected = groups.find((group) => group.workspaceId === selectedId) ?? groups[0]
    if (!selected) return null

    return (
        <div className="flex flex-col gap-4 p-4">
            {groups.length > 1 ? (
                <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-xs">Workspace</p>
                    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                        {groups.map((group) => {
                            const isSelected = group.workspaceId === selected.workspaceId
                            return (
                                <button
                                    key={group.workspaceId}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => setSelectedId(group.workspaceId)}
                                    className={`min-h-11 shrink-0 rounded-md border px-3 text-xs ${
                                        isSelected
                                            ? "border-foreground text-foreground"
                                            : "border-border text-muted-foreground"
                                    }`}
                                >
                                    {group.workspaceName}
                                </button>
                            )
                        })}
                    </div>
                </div>
            ) : (
                <h2 className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Building2 aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">{selected.workspaceName}</span>
                    <span className="shrink-0 opacity-70">workspace</span>
                </h2>
            )}

            <div className="flex flex-col gap-2">
                {selected.projects.map((project) => (
                    <button
                        key={project.project_id}
                        type="button"
                        className="border-border min-h-11 rounded-md border px-3 py-2.5 text-left text-xs"
                        onClick={() =>
                            void router.replace(
                                `/w/${selected.workspaceId}/p/${project.project_id}/sessions`,
                            )
                        }
                    >
                        {project.project_name}
                        {project.is_demo ? (
                            <span className="text-muted-foreground ml-2">demo</span>
                        ) : null}
                    </button>
                ))}
            </div>
        </div>
    )
}

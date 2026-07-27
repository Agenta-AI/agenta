import {useRouter} from "next/router"

import type {MobileProject} from "@/lib/context"

export interface WorkspaceGroup {
    workspaceId: string
    workspaceName: string
    projects: MobileProject[]
}

/** Raw nested picker: workspace headers with tappable project rows. */
export const WorkspaceProjectList = ({groups}: {groups: WorkspaceGroup[]}) => {
    const router = useRouter()
    return (
        <div className="flex flex-col gap-5 p-4">
            <h1 className="text-sm font-semibold">Choose a project</h1>
            {groups.map((group) => (
                <section key={group.workspaceId} className="flex flex-col gap-1.5">
                    <h2 className="text-muted-foreground text-xs">{group.workspaceName}</h2>
                    {group.projects.map((project) => (
                        <button
                            key={project.project_id}
                            type="button"
                            className="border-border min-h-11 rounded-md border px-3 py-2.5 text-left text-xs"
                            onClick={() =>
                                void router.replace(
                                    `/w/${group.workspaceId}/p/${project.project_id}/sessions`,
                                )
                            }
                        >
                            {project.project_name}
                            {project.is_demo ? (
                                <span className="text-muted-foreground ml-2">demo</span>
                            ) : null}
                        </button>
                    ))}
                </section>
            ))}
        </div>
    )
}

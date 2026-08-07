import {useRouter} from "next/router"

import type {WorkspaceGroup} from "./workspaceGroups"

/** Tappable project rows for the selected workspace; the workspace itself is chosen in the header. */
export const ProjectList = ({group}: {group: WorkspaceGroup}) => {
    const router = useRouter()
    return (
        <div className="flex flex-col gap-2 p-4">
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
        </div>
    )
}

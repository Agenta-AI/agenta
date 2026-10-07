import {ProjectsPage} from "@agenta/settings-ui"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {NameDialog} from "./NameDialog"
import type {SettingsTabProps} from "./settingsTabProps"
import {switchSettingsContext} from "./switchContext"
import {useSettingsOrg} from "./useSettingsOrg"

/**
 * Mobile binding: the shared projects table, with create / delete as modals; rename is inline
 * (the desktop uses antd modals — same verbs, each app's own idiom). The mutations live in
 * ProjectsPage; this only supplies the surfaces that collect the input.
 */
export const ProjectsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const router = useRouter()
    const queryClient = useQueryClient()
    const {projects: query} = useSettingsOrg(workspaceId)
    return (
        <ProjectsPage
            projects={query.data ?? []}
            isLoading={query.isPending}
            workspaceId={workspaceId}
            currentProjectId={projectId}
            // The nav switcher reads its own projects list.
            onChanged={() => void queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})}
            onSwitch={(project) =>
                switchSettingsContext(router, {
                    workspaceId: project.workspace_id ?? workspaceId,
                    projectId: project.project_id,
                    tab: "projects",
                })
            }
            renderCreateDialog={({open, onClose, onSubmit, pending}) => (
                <NameDialog
                    open={open}
                    title="New project"
                    description="Projects group your agents, datasets and deployments."
                    placeholder="Project name"
                    submitLabel="Create"
                    pending={pending}
                    onClose={onClose}
                    onSubmit={(name) => onSubmit({name})}
                />
            )}
            renderDeleteDialog={({open, onClose, onSubmit, pending, project}) => (
                <AlertDialog
                    open={open}
                    onOpenChange={(next) => (next || pending ? undefined : onClose())}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete project</AlertDialogTitle>
                            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <p className="m-0 text-sm">
                            Permanently deletes {project?.project_name}, including all of its
                            agents, datasets and deployments.
                        </p>
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" onClick={onClose} disabled={pending}>
                                    Cancel
                                </Button>
                            </AlertDialogCancel>
                            {/* The page closes it once the delete lands. */}
                            <AlertDialogAction asChild>
                                <Button
                                    variant="destructive"
                                    disabled={pending}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        onSubmit()
                                    }}
                                >
                                    {pending ? "Deleting…" : "Delete project"}
                                </Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        />
    )
}

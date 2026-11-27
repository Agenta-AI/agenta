import {useEffect} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsProjectsTabCatalog from "@agenta/i18n/catalogs/settings.projectsTab"
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

import {useProjectPermission} from "../context/useProjectPermission"
import {readLimitRefusal} from "../limits/limitRefusal"
import {LimitRefusalNotice} from "../limits/LimitRefusalNotice"
import {ProjectLimitNotice} from "../limits/ProjectLimitNotice"
import {useLimitRefusal} from "../limits/useLimitRefusal"

import {isAtLimit} from "./licenseApi"
import {NameDialog} from "./NameDialog"
import {ProjectsUsageNotice} from "./ProjectsUsageNotice"
import type {SettingsTabProps} from "./settingsTabProps"
import {switchSettingsContext} from "./switchContext"
import {invalidateLicenseUsage, useLicenseUsage} from "./useLicenseUsage"
import {useOrganizationOwner} from "./useOrganizationOwner"
import {useSettingsOrg} from "./useSettingsOrg"

/**
 * Mobile binding: the shared projects table, with create / delete as modals; rename is inline
 * (the desktop uses antd modals — same verbs, each app's own idiom). The mutations live in
 * ProjectsPage; this only supplies the surfaces that collect the input.
 */
export const ProjectsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const t = useT(commonCatalog, settingsProjectsTabCatalog)
    const router = useRouter()
    const queryClient = useQueryClient()
    const {projects: query} = useSettingsOrg(workspaceId)
    const canCreate = useProjectPermission(projectId, "create_workspace")
    const canEdit = useProjectPermission(projectId, "edit_workspace")
    // The default project carries organization writes, so the API lets only owners and admins
    // choose it, also where a member may create and rename projects.
    const {isOwner} = useOrganizationOwner(workspaceId)
    const currentRole = query.data?.find((project) => project.project_id === projectId)?.user_role
    const canSetDefault = isOwner || currentRole === "admin" || currentRole === "owner"
    // Deleting a project loses its data for good: the route checks `delete_workspace`, which only
    // the owner role holds by default.
    const canDelete = useProjectPermission(projectId, "delete_workspace")
    return (
        <>
            <ProjectsUsageNotice projectId={projectId} />
            <ProjectsPage
                projects={query.data ?? []}
                isLoading={query.isPending}
                workspaceId={workspaceId}
                currentProjectId={projectId}
                canCreate={canCreate}
                canEdit={canEdit}
                canSetDefault={canSetDefault}
                canDelete={canDelete}
                // The nav switcher reads its own projects list.
                onChanged={() => {
                    void queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})
                    void invalidateLicenseUsage(queryClient)
                }}
                onSwitch={(project) =>
                    switchSettingsContext(router, {
                        workspaceId: project.organization_id ?? project.workspace_id ?? workspaceId,
                        projectId: project.project_id,
                    })
                }
                // The dialog shows a limit refusal itself, as the drawer's sheet does.
                handlesCreateError={(error) => readLimitRefusal(error) !== null}
                renderCreateDialog={({open, onClose, onSubmit, pending, error}) => (
                    <CreateProjectDialog
                        open={open}
                        workspaceId={workspaceId}
                        projectId={projectId}
                        pending={pending}
                        error={error}
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
                                <AlertDialogTitle>
                                    {t("settings.projectsTab.deleteTitle")}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t("common.thisCannotBeUndone")}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <p className="m-0 text-body">
                                {t("settings.projectsTab.deleteBody", {
                                    name: project?.project_name ?? "",
                                })}
                            </p>
                            <AlertDialogFooter>
                                <AlertDialogCancel asChild>
                                    <Button variant="outline" onClick={onClose} disabled={pending}>
                                        {t("common.cancel")}
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
                                        {pending
                                            ? t("settings.projectsTab.deleting")
                                            : t("settings.projectsTab.deleteTitle")}
                                    </Button>
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
            />
        </>
    )
}

/**
 * The create dialog, which reads the project usage again each time it opens. A limit refusal
 * from submit shows the same notice as the drawer's sheet, until a newer usage read shows room.
 */
export const CreateProjectDialog = ({
    open,
    workspaceId,
    projectId,
    pending,
    error,
    onClose,
    onSubmit,
}: {
    open: boolean
    workspaceId: string
    projectId: string
    pending: boolean
    /** The last submit's failure, from the page. */
    error?: unknown
    onClose: () => void
    onSubmit: (name: string) => void
}) => {
    const t = useT(commonCatalog, settingsProjectsTabCatalog)
    const usage = useLicenseUsage(projectId, open)
    const projects = usage.data?.projects
    const atLimit = isAtLimit(projects)
    const {refusal, refuse, clear} = useLimitRefusal(usage, projects)
    useEffect(() => {
        const next = readLimitRefusal(error)
        if (next) refuse(next)
        else clear()
    }, [error, refuse, clear])
    return (
        <NameDialog
            open={open}
            submitDisabled={atLimit || Boolean(refusal)}
            notice={
                atLimit && projects ? (
                    <ProjectLimitNotice usage={projects} projectId={projectId} />
                ) : refusal ? (
                    <LimitRefusalNotice
                        refusal={refusal}
                        workspaceId={workspaceId}
                        projectId={projectId}
                        onNavigate={onClose}
                    />
                ) : null
            }
            title={t("settings.projectsTab.newTitle")}
            description={t("settings.projectsTab.newDescription")}
            placeholder={t("settings.projectsTab.namePlaceholder")}
            submitLabel={t("common.create")}
            pending={pending}
            onClose={onClose}
            onSubmit={onSubmit}
        />
    )
}

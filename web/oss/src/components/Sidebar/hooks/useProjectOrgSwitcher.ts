import {useCallback, useMemo, useRef, useState} from "react"

import {useMutation} from "@tanstack/react-query"
import {App} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"
import Session from "supertokens-auth-react/recipe/session"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useSession} from "@/oss/hooks/useSession"
import useURL from "@/oss/hooks/useURL"
import {buildProjectSwitchHref} from "@/oss/lib/navigation/projectSwitchHref"
import type {OrgDetails} from "@/oss/lib/Types"
import {checkOrganizationAccess} from "@/oss/services/organization/api"
import type {ProjectsResponse} from "@/oss/services/project/types"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {useOrgData} from "@/oss/state/org"
import {
    AUTH_UPGRADE_IDENTITIES_KEY,
    AUTH_UPGRADE_ORG_KEY,
    authUpgradeAtom,
} from "@/oss/state/org/authUpgrade"
import {
    cacheWorkspaceOrgPair,
    orgsAtom as organizationsAtom,
    selectedOrgIdAtom,
} from "@/oss/state/org/selectors/org"
import {cacheLastUsedProjectId, useProjectData} from "@/oss/state/project"
import {authFlowAtom} from "@/oss/state/session"
import {settingsTabAtom} from "@/oss/state/settings"

const formatErrorMessage = (detail: any, fallback: string) => {
    if (typeof detail === "string") return detail
    if (detail && typeof detail.message === "string") return detail.message
    return fallback
}

export interface SwitcherOrg {
    id: string
    name: string
}

/**
 * Data + actions for the combined project/org switcher. Consolidates the view / switch / create /
 * logout logic that previously lived across `ListOfOrgs` and `ListOfProjects`, minus the management
 * actions that now live in Settings.
 */
export const useProjectOrgSwitcher = () => {
    const router = useRouter()
    const {message} = App.useApp()
    const {logout} = useSession()
    const {projectURL} = useURL()

    const {selectedOrg, orgs, changeSelectedOrg, refetch} = useOrgData()
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)
    const organizationList = useAtomValue(organizationsAtom)
    const {project, projects, refetch: refetchProjects} = useProjectData()
    const settingsTab = useAtomValue(settingsTabAtom)
    const {workspaceId: currentWorkspaceId} = useAtomValue(appIdentifiersAtom)
    const setAuthFlow = useSetAtom(authFlowAtom)
    const setAuthUpgrade = useSetAtom(authUpgradeAtom)

    const effectiveSelectedId = selectedOrg?.id || selectedOrgId || orgs?.[0]?.id || null

    const safeOrganizationList = useMemo(
        () => (Array.isArray(organizationList) ? organizationList : []),
        [organizationList],
    )
    const currentOrg = useMemo<SwitcherOrg | null>(() => {
        const match =
            safeOrganizationList.find((org) => org.id === effectiveSelectedId) ||
            orgs.find((org) => org.id === effectiveSelectedId)
        if (!match?.id) return null
        return {id: match.id, name: (match.name as string) || "Organization"}
    }, [safeOrganizationList, orgs, effectiveSelectedId])

    const orgOptions = useMemo<SwitcherOrg[]>(
        () => orgs.filter((org) => org.id).map((org) => ({id: org.id, name: org.name as string})),
        [orgs],
    )

    const projectsByOrganization = useMemo(() => {
        const map = new Map<string, ProjectsResponse[]>()
        orgs.forEach((org) => map.set(org.id, []))
        projects.forEach((proj) => {
            if (!proj) return
            const organizationId =
                proj.organization_id ||
                orgs.find(
                    (org) =>
                        (org as Partial<OrgDetails>).default_workspace?.id === proj.workspace_id,
                )?.id
            if (!organizationId) return
            if (!map.has(organizationId)) map.set(organizationId, [])
            map.get(organizationId)?.push(proj)
        })
        return map
    }, [orgs, projects])

    const projectsForOrg = useMemo(
        () => (effectiveSelectedId ? (projectsByOrganization.get(effectiveSelectedId) ?? []) : []),
        [projectsByOrganization, effectiveSelectedId],
    )

    // ── Create project ─────────────────────────────────────────────────────
    const [createProjectOpen, setCreateProjectOpen] = useState(false)

    const navigateToProject = useCallback(
        (workspaceId: string, projectId: string, organizationId?: string | null) => {
            if (!workspaceId || !projectId) return
            cacheLastUsedProjectId(workspaceId, projectId)
            if (organizationId) cacheWorkspaceOrgPair(workspaceId, organizationId)
            const href = buildProjectSwitchHref({
                workspaceId,
                projectId,
                currentAsPath: router.asPath,
                settingsTab,
                queryTab: router.query.tab,
            })
            void router.push(href)
        },
        [router, settingsTab],
    )

    const createProjectMutation = useMutation({
        mutationFn: async ({name}: {name: string}) => {
            const {createProject} = await import("@/oss/services/project")
            return createProject({name: name.trim()}, currentWorkspaceId ?? undefined)
        },
        onSuccess: (createdProject) => {
            message.success("Project created")
            setCreateProjectOpen(false)
            // Only a real workspace id routes correctly; org id would build /w/<orgId>/... .
            const workspaceKey = createdProject?.workspace_id || currentWorkspaceId || ""
            if (workspaceKey && createdProject?.project_id) {
                navigateToProject(
                    workspaceKey,
                    createdProject.project_id,
                    createdProject.organization_id ?? effectiveSelectedId,
                )
            }
            void refetchProjects()
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to create project"))
        },
    })

    // ── Create organization ────────────────────────────────────────────────
    const [createOrgOpen, setCreateOrgOpen] = useState(false)

    const createOrgMutation = useMutation({
        mutationFn: async (values: {name: string}) => {
            const {createOrganization} = await import("@/oss/services/organization/api")
            return createOrganization({name: values.name.trim()})
        },
        onSuccess: async (createdOrg) => {
            message.success("Organization created")
            setCreateOrgOpen(false)
            await refetch()
            if (createdOrg?.id) await changeSelectedOrg(createdOrg.id)
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail || error?.message
            message.error(formatErrorMessage(detail, "Unable to create organization"))
        },
    })

    // ── Switch project / org ───────────────────────────────────────────────
    const switchProject = useCallback(
        (proj: ProjectsResponse) => {
            navigateToProject(
                proj.workspace_id || "",
                proj.project_id,
                proj.organization_id ?? effectiveSelectedId,
            )
        },
        [navigateToProject, effectiveSelectedId],
    )

    const lastDomainDeniedOrgIdRef = useRef<string | null>(null)
    const lastDomainDeniedAtRef = useRef<number>(0)

    const switchOrg = useCallback(
        async (organizationId: string) => {
            if (!organizationId || organizationId === effectiveSelectedId) return
            try {
                const result = await checkOrganizationAccess(organizationId)
                if (result.ok) {
                    await changeSelectedOrg(organizationId)
                    return
                }
                const detail = result.response?.data?.detail
                if (
                    detail?.error === "AUTH_UPGRADE_REQUIRED" ||
                    detail?.error === "AUTH_SSO_DENIED"
                ) {
                    setAuthFlow("authing")
                    // Write both keys before opening the modal so the SSO redirect can't
                    // fire ahead of the identities write.
                    if (typeof window !== "undefined") {
                        window.localStorage.setItem(AUTH_UPGRADE_ORG_KEY, organizationId)
                        try {
                            const payload = await Session.getAccessTokenPayloadSecurely()
                            const sessionIdentities =
                                payload?.session_identities || payload?.sessionIdentities || []
                            window.localStorage.setItem(
                                AUTH_UPGRADE_IDENTITIES_KEY,
                                JSON.stringify(sessionIdentities),
                            )
                        } catch {
                            // identities are optional for the redirect
                        }
                    }
                    setAuthUpgrade({open: true, orgId: organizationId, detail})
                    return
                }
                if (detail?.error === "AUTH_DOMAIN_DENIED") {
                    const content =
                        typeof detail?.message === "string"
                            ? detail.message
                            : "Your email domain is not allowed for this organization."
                    const now = Date.now()
                    const recentlyNotified =
                        lastDomainDeniedOrgIdRef.current === organizationId &&
                        now - lastDomainDeniedAtRef.current < 2000
                    if (!recentlyNotified) {
                        lastDomainDeniedOrgIdRef.current = organizationId
                        lastDomainDeniedAtRef.current = now
                        message.error({content, key: "domain-denied"})
                    }
                    return
                }
                message.error(
                    formatErrorMessage(
                        result.response?.data?.detail || result.response?.statusText,
                        "Unable to switch organization",
                    ),
                )
            } catch (error) {
                message.error("Unable to switch organization")
            }
        },
        [changeSelectedOrg, effectiveSelectedId, message, setAuthFlow, setAuthUpgrade],
    )

    const goToOrgSettings = useCallback(() => {
        if (!projectURL) return
        void router.push(`${projectURL}/settings?tab=organizationGeneral`)
    }, [projectURL, router])

    const confirmLogout = useCallback(() => {
        AlertPopup({
            title: "Logout",
            message: "Are you sure you want to logout?",
            centered: true,
            onOk: logout,
        })
    }, [logout])

    const createProject = useMemo(
        () => ({
            open: createProjectOpen,
            setOpen: setCreateProjectOpen,
            submit: (name: string) => createProjectMutation.mutate({name}),
            isPending: createProjectMutation.isPending,
        }),
        [createProjectOpen, createProjectMutation],
    )

    const createOrg = useMemo(
        () => ({
            open: createOrgOpen,
            setOpen: setCreateOrgOpen,
            submit: (name: string) => createOrgMutation.mutate({name}),
            isPending: createOrgMutation.isPending,
        }),
        [createOrgOpen, createOrgMutation],
    )

    return {
        currentOrg,
        currentProject: project ?? null,
        orgOptions,
        projectsForOrg,
        switchProject,
        switchOrg,
        goToOrgSettings,
        confirmLogout,
        createProject,
        createOrg,
    }
}

import {useMemo} from "react"

import {SignOut} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {Space, Tag, Typography} from "antd"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import Avatar from "@/oss/components/Avatar/Avatar"
import {Organization as OrganizationRecord} from "@/oss/lib/Types"
import {ProjectsResponse} from "@/oss/services/project/types"

import {UseDropdownItemsProps, DropdownItemsResult, DropdownItemMeta} from "./types"

const {Text} = Typography
type MenuItemType = NonNullable<MenuProps["items"]>[number]

type OrganizationEntry = {
    id: string
    organization: OrganizationRecord | null
    displayName: string
    projects: ProjectsResponse[]
}

const buildKey = (...segments: (string | null | undefined)[]) =>
    segments.filter(Boolean).join(":")

const createSectionHeader = (key: string, labelText: string): MenuItemType => ({
    key,
    disabled: true,
    className: "!cursor-default hover:!bg-transparent",
    label: (
        <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {labelText}
        </div>
    ),
})

export const useDropdownItems = ({
    selectedOrganization,
    user,
    organizations,
    project,
    logout,
    projects,
    interactive,
}: UseDropdownItemsProps): DropdownItemsResult => {
    const organizationEntries = useMemo<OrganizationEntry[]>(() => {
        const map = new Map<string, OrganizationEntry>()

        const ensureEntry = (id: string, name?: string | null) => {
            if (!id) return null
            if (!map.has(id)) {
                const matchedOrganization = organizations.find((organization) => organization.id === id) || null
                map.set(id, {
                    id,
                    organization: matchedOrganization,
                    displayName: matchedOrganization?.name || name || "Organization",
                    projects: [],
                })
            }
            return map.get(id)!
        }

        organizations.forEach((organization) => {
            map.set(organization.id, {
                id: organization.id,
                organization,
                displayName: organization.name,
                projects: [],
            })
        })

        projects.forEach((proj) => {
            const organizationMatch =
                proj.organization_id ||
                organizations.find((organization) => organization.default_workspace?.id === proj.workspace_id)?.id ||
                proj.workspace_id ||
                "unknown-organization"
            const entry = ensureEntry(organizationMatch, proj.organization_name || proj.workspace_name || null)
            entry?.projects.push(proj)
        })

        return Array.from(map.values())
    }, [organizations, projects])

    const {items, keyMap} = useMemo(() => {
        const entryMap: Record<string, DropdownItemMeta> = {}
        if (!user?.id) return {items: [], keyMap: entryMap}

        const organizationItems: MenuProps["items"] = organizationEntries
            .filter(({organization, projects}) => organization || projects.length)
            .map(({organization, projects, displayName, id}) => {
                const organizationKey = buildKey("organization", id)

                entryMap[organizationKey] = {
                    type: "organization",
                    organizationId: organization?.id ?? null,
                }

                const projectItems = projects.map((proj) => {
                    const projectKey = buildKey("project", proj.workspace_id, proj.project_id)
                    entryMap[projectKey] = {
                        type: "project",
                        workspaceId: proj.workspace_id || "",
                        organizationId: proj.organization_id ?? organization?.id ?? null,
                        projectId: proj.project_id,
                    }
                    return {
                        key: projectKey,
                        disabled: !interactive,
                        label: (
                            <div className="flex items-center gap-2 justify-between">
                                <span>{proj.project_name}</span>
                                {proj.is_default_project && (
                                    <Tag color="blue" className="m-0">
                                        Default
                                    </Tag>
                                )}
                            </div>
                        ),
                    }
                })

                const projectChildren =
                    projectItems.length > 0
                        ? [
                              createSectionHeader(
                                  `${organizationKey}-projects-title`,
                                  "Projects",
                              ),
                              {
                                  type: "divider",
                                  key: `${organizationKey}-projects-divider`,
                              },
                              ...projectItems,
                          ]
                        : undefined

                return {
                    key: organizationKey,
                    label: (
                        <Space>
                            <Avatar size="small" name={displayName} />
                            <Text>{displayName}</Text>
                        </Space>
                    ),
                    disabled: !interactive,
                    children: projectChildren,
                }
            })

        const logoutKey = "logout"
        entryMap[logoutKey] = {
            type: "logout",
            action: () => {
                AlertPopup({
                    title: "Logout",
                    message: "Are you sure you want to logout?",
                    onOk: logout,
                })
            },
        }

        const decoratedOrganizationItems =
            organizationItems.length > 0
                ? [
                      createSectionHeader("organizations-title", "Organizations"),
                      {type: "divider", key: "organizations-divider"},
                      ...organizationItems,
                  ]
                : organizationItems

        const menuItems: MenuProps["items"] = [
            ...decoratedOrganizationItems,
            {type: "divider", key: "logout-divider"},
            {
                key: logoutKey,
                danger: true,
                label: (
                    <div className="flex items-center gap-2">
                        <SignOut size={16} />
                        Logout
                    </div>
                ),
            },
        ]

        return {items: menuItems, keyMap: entryMap}
    }, [interactive, logout, organizationEntries, user?.id])

    const selectedKey = useMemo(() => {
        if (project?.workspace_id && project?.project_id) {
            return buildKey("project", project.workspace_id, project.project_id)
        }
        if (selectedOrganization?.id) {
            return buildKey("organization", selectedOrganization.id)
        }
        return undefined
    }, [project?.project_id, project?.workspace_id, selectedOrganization?.id])

    const preferredOrganizationKey = useMemo(() => {
        const candidates = [
            selectedOrganization?.id,
            project?.organization_id,
            project?.workspace_id
                ? organizationEntries.find((entry) =>
                      entry.projects.some((proj) => proj.workspace_id === project.workspace_id),
                  )?.id
                : undefined,
        ].filter(Boolean) as string[]

        let resolvedOrganizationId: string | undefined

        for (const candidate of candidates) {
            const match = organizationEntries.find((entry) => entry.id === candidate)
            if (match?.id) {
                resolvedOrganizationId = match.id
                break
            }
        }

        if (!resolvedOrganizationId && organizationEntries.length) {
            resolvedOrganizationId = organizationEntries[0].id
        }

        return resolvedOrganizationId ? buildKey("organization", resolvedOrganizationId) : undefined
    }, [organizationEntries, project?.organization_id, project?.workspace_id, selectedOrganization?.id])

    return {
        items,
        selectedKey,
        keyMap,
        preferredOrganizationKey,
    }
}

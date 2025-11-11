import {memo, useCallback, useMemo, useState} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, ButtonProps, Dropdown, DropdownProps, MenuProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useSession} from "@/oss/hooks/useSession"
import {useOrganizationData} from "@/oss/state/organization"
import {
    organizationsAtom as organizationsAtom,
    selectedOrganizationIdAtom,
    cacheWorkspaceOrganizationPair,
} from "@/oss/state/organization/selectors/organization"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

import Avatar from "../../Avatar/Avatar"
import {useDropdownItems} from "../hooks/useDropdownItems"

interface ListOfOrganizationsProps extends DropdownProps {
    collapsed: boolean
    buttonProps?: ButtonProps
    /**
     * When false, renders a non-interactive display (no dropdown, no navigation)
     * Useful on pages like post-signup where changing organization should not trigger redirects
     */
    interactive?: boolean
    /**
     * Optional override for currently selected organization id when URL-derived selection is not available
     */
    overrideOrganizationId?: string
    /**
     * When false, organization items remain visible but are not actionable. Logout remains actionable.
     */
    organizationSelectionEnabled?: boolean
}

const ListOfOrganizations = ({
    collapsed,
    buttonProps,
    interactive = true,
    overrideOrganizationId,
    organizationSelectionEnabled = true,
    ...props
}: ListOfOrganizationsProps) => {
    const router = useRouter()
    const {user} = useProfileData()
    const {logout} = useSession()
    const {
        selectedOrganization: selectedOrganization,
        organizations: organizations,
        changeSelectedOrganization: changeSelectedOrganizationanization,
    } = useOrganizationData()
    const selectedOrganizationId = useAtomValue(selectedOrganizationIdAtom)
    const effectiveSelectedId = overrideOrganizationId || selectedOrganizationId
    const organizationList = useAtomValue(organizationsAtom)
    const selectedBasicOrganization = useMemo(
        () => organizationList.find((organization) => organization.id === effectiveSelectedId) || null,
        [organizationList, effectiveSelectedId],
    )
    const {project, projects} = useProjectData()
    const selectedProjectName = project?.project_name
    const displayName =
        selectedProjectName ||
        selectedBasicOrganization?.name ||
        selectedOrganization?.name ||
        "Project"

    const {items: dropdownItems, selectedKey, keyMap, preferredOrganizationKey} = useDropdownItems({
        logout,
        organizations: organizations,
        selectedOrganization: selectedOrganization,
        user,
        project,
        projects,
        interactive,
    })

    const [dropdownOpen, setDropdownOpen] = useState(false)

    const contentButton = (
        <Button
            type="text"
            className={clsx([
                "flex items-center justify-between gap-2 w-full px-1.5 py-4",
                {"!w-auto": collapsed},
            ])}
            {...buttonProps}
        >
            <div className="flex items-center gap-2">
                <Avatar size="small" name={displayName} />
                {!collapsed && (
                    <span className="max-w-[150px] truncate" title={displayName}>
                        {displayName}
                    </span>
                )}
            </div>
            {!collapsed && interactive && (
                <CaretDown
                    size={14}
                    className={clsx("transition-transform", dropdownOpen ? "rotate-180" : "")}
                />
            )}
        </Button>
    )

    const canShow = Boolean(
        (project?.project_id || effectiveSelectedId || selectedOrganization?.id) && user?.id,
    )

    const navigateToProject = useCallback(
        (workspaceId: string, projectId: string, organizationId?: string | null) => {
            if (!workspaceId || !projectId) return
            if (organizationId) cacheWorkspaceOrganizationPair(workspaceId, organizationId)
            const href = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}/apps`
            void router.push(href)
        },
        [router],
    )

    const handleMenuClick: MenuProps["onClick"] = ({key}) => {
        const meta = keyMap[key as string]
        if (!meta) return

        if (meta.type === "logout") {
            setDropdownOpen(false)
            meta.action()
            return
        }

        if (!interactive) {
            setDropdownOpen(false)
            return
        }

        switch (meta.type) {
            case "organization":
                setDropdownOpen(false)
                if (meta.organizationId) {
                    void changeSelectedOrganization(meta.organizationId)
                }
                break
            case "project":
                setDropdownOpen(false)
                navigateToProject(meta.workspaceId, meta.projectId, meta.organizationId ?? null)
                break
        }
    }

    return (
        <div className="h-[51px] flex items-center justify-center px-2">
            {canShow ? (
                interactive ? (
                    <Dropdown
                        {...props}
                        trigger={["click"]}
                        placement="bottomRight"
                        destroyPopupOnHide
                        overlayStyle={{zIndex: 2000}}
                        menu={{
                            items: dropdownItems,
                            selectedKeys: selectedKey ? [selectedKey] : [],
                            defaultOpenKeys: preferredOrganizationKey
                                ? [preferredOrganizationKey]
                                : undefined,
                            onClick: (info) => {
                                const meta = keyMap[info.key as string]
                                if (!meta) return
                                if (!organizationSelectionEnabled && meta.type !== "logout") {
                                    setDropdownOpen(false)
                                    return
                                }
                                handleMenuClick(info)
                            },
                        }}
                        onOpenChange={setDropdownOpen}
                        className={clsx({"flex items-center justify-center": collapsed})}
                    >
                        {contentButton}
                    </Dropdown>
                ) : (
                    // Non-interactive display (no dropdown, no navigation)
                    <div className={clsx({"flex items-center justify-center": collapsed})}>
                        {contentButton}
                    </div>
                )
            ) : null}
        </div>
    )
}

export default memo(ListOfOrganizations)

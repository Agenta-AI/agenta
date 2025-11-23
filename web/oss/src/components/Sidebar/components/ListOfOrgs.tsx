import {memo, useMemo, useState} from "react"

import {CaretDown, SignOut} from "@phosphor-icons/react"
import {Button, ButtonProps, Dropdown, DropdownProps, MenuProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useSession} from "@/oss/hooks/useSession"
import {useOrgData} from "@/oss/state/org"
import {orgsAtom as organizationsAtom, selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"
import {useRouter} from "next/router"

import Avatar from "../../Avatar/Avatar"
import ListOfProjects from "./ListOfProjects"

interface ListOfOrgsProps extends Omit<DropdownProps, "menu" | "children"> {
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

const ListOfOrgs = ({
    collapsed,
    buttonProps,
    interactive = true,
    overrideOrganizationId,
    organizationSelectionEnabled = true,
    ...dropdownProps
}: ListOfOrgsProps) => {
    const router = useRouter()
    const {user} = useProfileData()
    const {logout} = useSession()
    const {selectedOrg: selectedOrganization, orgs: organizations, changeSelectedOrg} = useOrgData()
    const selectedOrganizationId = useAtomValue(selectedOrgIdAtom)
    const effectiveSelectedId =
        overrideOrganizationId || selectedOrganization?.id || selectedOrganizationId
    const organizationList = useAtomValue(organizationsAtom)
    const selectedBasicOrganization = useMemo(
        () =>
            organizationList.find((organization) => organization.id === effectiveSelectedId) ||
            null,
        [organizationList, effectiveSelectedId],
    )
    const {project} = useProjectData()
    const organizationDisplayName =
        selectedBasicOrganization?.name ||
        selectedOrganization?.name ||
        organizations?.[0]?.name ||
        "Organization"

    const organizationMenuItems = useMemo<MenuProps["items"]>(() => {
        const items: MenuProps["items"] = organizations.map((organization) => ({
            key: `organization:${organization.id}`,
            disabled: !interactive || !organizationSelectionEnabled,
            label: (
                <div className="flex items-center gap-2">
                    <Avatar size="small" name={organization.name} />
                    <span className="truncate">{organization.name}</span>
                </div>
            ),
        }))

        if (items.length) {
            items.push({type: "divider", key: "organizations-divider"})
        }

        items.push({
            key: "logout",
            danger: true,
            label: (
                <div className="flex items-center gap-2">
                    <SignOut size={16} />
                    Logout
                </div>
            ),
        })

        return items
    }, [interactive, organizationSelectionEnabled, organizations])

    const [organizationDropdownOpen, setOrganizationDropdownOpen] = useState(false)

    const organizationButtonLabel = organizationDisplayName

    const sharedButtonProps = useMemo(() => {
        if (!buttonProps) {
            return {
                className: undefined,
                type: undefined,
                disabled: undefined,
                rest: {} as ButtonProps,
            }
        }

        const {className, type, disabled, ...rest} = buttonProps
        return {className, type, disabled, rest: rest as ButtonProps}
    }, [buttonProps])

    const renderSelectionButton = (
        label: string,
        placeholder: string,
        isOpen: boolean,
        showCaret: boolean,
        disabled?: boolean,
    ) => (
        <Button
            type={sharedButtonProps.type ?? "text"}
            className={clsx(
                "flex items-center justify-between gap-2 w-full px-1.5 py-3",
                {"!w-auto": collapsed},
                sharedButtonProps.className,
            )}
            disabled={disabled || sharedButtonProps.disabled}
            {...sharedButtonProps.rest}
        >
            <div className="flex items-center gap-2">
                <Avatar size="small" name={label || placeholder} />
                {!collapsed && (
                    <span className="max-w-[150px] truncate" title={label || placeholder}>
                        {label || placeholder}
                    </span>
                )}
            </div>
            {!collapsed && showCaret && (
                <CaretDown
                    size={14}
                    className={clsx("transition-transform", isOpen ? "rotate-180" : "")}
                />
            )}
        </Button>
    )

    const isSurveyPage = router.pathname === "/workspaces/accept" && Boolean(router.query.survey)
    const canShow = Boolean(
        (project?.project_id || effectiveSelectedId || selectedOrganization?.id) &&
            user?.id &&
            !isSurveyPage,
    )

    const handleOrganizationMenuClick: MenuProps["onClick"] = ({key}) => {
        if (key === "logout") {
            setOrganizationDropdownOpen(false)
            AlertPopup({
                title: "Logout",
                message: "Are you sure you want to logout?",
                onOk: logout,
            })
            return
        }

        if (!interactive || !organizationSelectionEnabled) {
            setOrganizationDropdownOpen(false)
            return
        }

        const [, organizationId] = (key as string).split(":")
        if (organizationId) {
            setOrganizationDropdownOpen(false)
            void changeSelectedOrg(organizationId)
        }
    }

    const selectedOrganizationKey = effectiveSelectedId
        ? [`organization:${effectiveSelectedId}`]
        : undefined

    return (
        <div className={clsx("flex flex-col gap-2 px-2 py-3", {"items-center": collapsed})}>
            {canShow ? (
                <>
                    {interactive ? (
                        <Dropdown
                            {...dropdownProps}
                            trigger={["click"]}
                            placement="bottomRight"
                            destroyPopupOnHide
                            overlayStyle={{zIndex: 2000}}
                            onOpenChange={setOrganizationDropdownOpen}
                            className={clsx({"flex items-center justify-center": collapsed})}
                            menu={{
                                items: organizationMenuItems,
                                selectedKeys: selectedOrganizationKey,
                                onClick: handleOrganizationMenuClick,
                            }}
                        >
                            {renderSelectionButton(
                                organizationButtonLabel,
                                "Organization",
                                organizationDropdownOpen,
                                true,
                                false,
                            )}
                        </Dropdown>
                    ) : (
                        <div className={clsx({"flex items-center justify-center": collapsed})}>
                            {renderSelectionButton(
                                organizationButtonLabel,
                                "Organization",
                                false,
                                false,
                                true,
                            )}
                        </div>
                    )}

                    <ListOfProjects
                        collapsed={collapsed}
                        buttonProps={buttonProps}
                        interactive={interactive}
                        selectedOrganizationId={effectiveSelectedId}
                        dropdownProps={dropdownProps}
                    />
                </>
            ) : null}
        </div>
    )
}

export default memo(ListOfOrgs)

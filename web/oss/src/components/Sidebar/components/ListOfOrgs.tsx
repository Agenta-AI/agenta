import {memo, useMemo, useState} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, ButtonProps, Dropdown, DropdownProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {useSession} from "@/oss/hooks/useSession"
import {useOrgData} from "@/oss/state/org"
import {orgsAtom, selectedOrgIdAtom} from "@/oss/state/org/selectors/org"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

import Avatar from "../../Avatar/Avatar"
import {useDropdownItems} from "../hooks/useDropdownItems"

interface ListOfOrgsProps extends DropdownProps {
    collapsed: boolean
    buttonProps?: ButtonProps
    /**
     * When false, renders a non-interactive display (no dropdown, no navigation)
     * Useful on pages like post-signup where changing org should not trigger redirects
     */
    interactive?: boolean
    /**
     * Optional override for currently selected org id when URL-derived selection is not available
     */
    overrideOrgId?: string
    /**
     * When false, org items remain visible but are not actionable. Logout remains actionable.
     */
    orgSelectionEnabled?: boolean
}

const ListOfOrgs = ({
    collapsed,
    buttonProps,
    interactive = true,
    overrideOrgId,
    orgSelectionEnabled = true,
    ...props
}: ListOfOrgsProps) => {
    const {user} = useProfileData()
    const {logout} = useSession()
    const {selectedOrg, orgs, changeSelectedOrg} = useOrgData()
    const selectedOrgId = useAtomValue(selectedOrgIdAtom)
    const effectiveSelectedId = overrideOrgId || selectedOrgId
    const orgList = useAtomValue(orgsAtom)
    const selectedBasicOrg = useMemo(
        () => orgList.find((o) => o.id === effectiveSelectedId) || null,
        [orgList, effectiveSelectedId],
    )
    const {project, projects} = useProjectData()

    const dropdownItems = useDropdownItems({
        logout,
        orgs,
        selectedOrg,
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
                <Avatar size="small" name={selectedBasicOrg?.name || selectedOrg?.name} />
                {!collapsed && (
                    <span
                        className="max-w-[150px] truncate"
                        title={selectedBasicOrg?.name || selectedOrg?.name}
                    >
                        {selectedBasicOrg?.name || selectedOrg?.name}
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

    const canShow = Boolean((effectiveSelectedId || selectedOrg?.id) && user?.id)

    return (
        <div className="h-[51px] flex items-center justify-center px-2">
            {canShow ? (
                interactive ? (
                    <Dropdown
                        {...props}
                        trigger={["click"]}
                        placement="bottomRight"
                        overlayStyle={{zIndex: 2000}}
                        menu={{
                            // @ts-ignore - dropdown items union types differ from antd ItemType
                            items: dropdownItems,
                            selectedKeys:
                                selectedBasicOrg?.id || selectedOrg?.id
                                    ? [String(selectedBasicOrg?.id || selectedOrg?.id)]
                                    : [],
                            onClick: ({key}) => {
                                if (key === "logout") {
                                    setDropdownOpen(false)
                                    return
                                }
                                if (!orgSelectionEnabled) {
                                    setDropdownOpen(false)
                                    return
                                }
                                setDropdownOpen(false)
                                void changeSelectedOrg(String(key))
                            },
                        }}
                        onOpenChange={setDropdownOpen}
                        open={dropdownOpen}
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

export default memo(ListOfOrgs)

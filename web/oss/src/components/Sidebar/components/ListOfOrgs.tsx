import {memo, useState} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, ButtonProps, Dropdown, DropdownProps} from "antd"
import clsx from "clsx"

import {useOrgData} from "@/oss/contexts/org.context"
import {useProfileData} from "@/oss/contexts/profile.context"
import {useProjectData} from "@/oss/contexts/project.context"
import {useSession} from "@/oss/hooks/useSession"

import Avatar from "../../Avatar/Avatar"
import {useDropdownItems} from "../hooks/useDropdownItems"

interface ListOfOrgsProps extends DropdownProps {
    collapsed: boolean
    buttonProps?: ButtonProps
}

const ListOfOrgs = ({collapsed, buttonProps, ...props}: ListOfOrgsProps) => {
    const {user} = useProfileData()
    const {logout} = useSession()
    const {project, projects} = useProjectData()
    const {selectedOrg, orgs, changeSelectedOrg} = useOrgData()

    const dropdownItems = useDropdownItems({logout, orgs, selectedOrg, user, project, projects})

    const [dropdownOpen, setDropdownOpen] = useState(false)

    return (
        <div className="h-[51px] flex items-center justify-center px-2">
            {selectedOrg?.id && user?.id && (
                <Dropdown
                    {...props}
                    trigger={["click"]}
                    menu={{
                        // @ts-ignore
                        items: dropdownItems,
                        selectedKeys: [selectedOrg.id],
                        onClick: ({key}) => {
                            if (["logout"].includes(key)) return
                            changeSelectedOrg(key)
                        },
                    }}
                    onOpenChange={setDropdownOpen}
                    open={dropdownOpen}
                    className={clsx([{"flex items-center justify-center": collapsed}])}
                >
                    <Button
                        type="text"
                        className={clsx([
                            "flex items-center justify-between gap-2 w-full px-1.5 py-4",
                            {"!w-auto": collapsed},
                        ])}
                        {...buttonProps}
                    >
                        <div className="flex items-center gap-2">
                            <Avatar
                                size="small"
                                name={selectedOrg.default_workspace?.name || selectedOrg.name}
                            />
                            {!collapsed && (
                                <span
                                    className="max-w-[150px] truncate"
                                    title={selectedOrg.default_workspace?.name || selectedOrg.name}
                                >
                                    {selectedOrg.default_workspace?.name || selectedOrg.name}
                                </span>
                            )}
                        </div>

                        {!collapsed && (
                            <CaretDown
                                size={14}
                                className={clsx(
                                    "transition-transform",
                                    dropdownOpen ? "rotate-180" : "",
                                )}
                            />
                        )}
                    </Button>
                </Dropdown>
            )}
        </div>
    )
}

export default memo(ListOfOrgs)

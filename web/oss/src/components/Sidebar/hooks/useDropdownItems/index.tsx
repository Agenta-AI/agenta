import {useMemo} from "react"

import {SignOut} from "@phosphor-icons/react"
import {Space, Typography} from "antd"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import Avatar from "@/oss/components/Avatar/Avatar"
import useURL from "@/oss/hooks/useURL"

import {UseDropdownItemsProps} from "./types"

const {Text} = Typography

export const useDropdownItems = ({
    selectedOrg,
    user,
    orgs,
    project,
    logout,
    projects,
    interactive,
}: UseDropdownItemsProps) => {
    const {projectURL} = useURL()

    const filteredOrgs = useMemo(() => {
        return projects.flatMap((project) =>
            orgs.filter((org) => org.id === project.organization_id),
        )
    }, [projects, orgs])

    const dropdownItems = useMemo(() => {
        if (selectedOrg?.id && user?.id) {
            return [
                ...filteredOrgs.map((org: any) => ({
                    key: org.id,
                    label: (
                        <Space>
                            <Avatar size="small" name={org.name} />
                            <Text>{org.name}</Text>
                        </Space>
                    ),
                    disabled: !interactive,
                })),
                {type: "divider"},
                {
                    key: "logout",
                    danger: true,
                    label: (
                        <div className="flex items-center gap-2">
                            <SignOut size={16} />
                            Logout
                        </div>
                    ),
                    onClick: () => {
                        AlertPopup({
                            title: "Logout",
                            message: "Are you sure you want to logout?",
                            onOk: logout,
                        })
                    },
                },
            ]
        } else {
            return []
        }
    }, [interactive, filteredOrgs, logout, orgs, project?.is_demo, selectedOrg?.id, user?.id])

    return dropdownItems
}

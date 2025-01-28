import {isDemo} from "@/lib/helpers/utils"
import {Space, Typography} from "antd"
import Avatar from "@/components/Avatar/Avatar"
import {useMemo} from "react"
import Link from "next/link"
import AlertPopup from "@/components/AlertPopup/AlertPopup"
import {Gear, SignOut} from "@phosphor-icons/react"
import {UseDropdownItemsProps} from "./types"

const {Text} = Typography

export const useDropdownItems = ({
    selectedOrg,
    user,
    orgs,
    project,
    logout,
}: UseDropdownItemsProps) => {
    const dropdownItems = useMemo(() => {
        if (selectedOrg?.id && user?.id && isDemo()) {
            return [
                ...orgs.map((org: any) => ({
                    key: org.id,
                    label: (
                        <Space>
                            <Avatar size="small" name={org.name} />
                            <Text>{org.name}</Text>
                        </Space>
                    ),
                })),
                {type: "divider"},
                !project?.is_demo && {
                    key: "settings",
                    label: (
                        <Link href={"/settings"} className="flex items-center gap-2">
                            <Gear size={16} />
                            <Text>Settings</Text>
                        </Link>
                    ),
                },
                {
                    key: "logout",
                    label: (
                        <div className="flex items-center gap-2">
                            <SignOut size={16} />
                            <Text>Logout</Text>
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
    }, [logout, orgs, project?.is_demo, selectedOrg?.id, user?.id])

    return dropdownItems
}

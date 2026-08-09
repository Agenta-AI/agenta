import {useState} from "react"

import type {User} from "@agenta/shared/types"
import {message} from "@agenta/ui/app-message"
import {EditOutlined, SyncOutlined} from "@ant-design/icons"
import {Dropdown, Space, Tag, Tooltip, Typography} from "antd"

import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {snakeToTitle} from "@/oss/lib/helpers/utils"
import {WorkspaceMember} from "@/oss/lib/Types"
import {assignWorkspaceRole, unAssignWorkspaceRole} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useWorkspaceRoles} from "@/oss/state/workspace"

export const Roles: React.FC<{
    member: WorkspaceMember
    signedInUser: User
    organizationId: string
    workspaceId: string
}> = ({member, signedInUser, organizationId, workspaceId}) => {
    const [loading, setLoading] = useState(false)
    const {roles} = useWorkspaceRoles()
    const {selectedOrg, refetch} = useOrgData()
    const {canModifyRoles} = useWorkspacePermissions()

    const {user} = member
    const isOwner = user.id === selectedOrg?.owner_id
    const readOnly = user.id === signedInUser?.id || user.status !== "member" || isOwner
    const role = member.roles[0]

    const handleChangeRole = async (roleName: string) => {
        setLoading(true)
        try {
            await assignWorkspaceRole({
                organizationId,
                workspaceId,
                email: user.email,
                role: roleName,
            })
            await Promise.all(
                member.roles
                    .filter((item) => item.role_name !== roleName)
                    .map((item) =>
                        unAssignWorkspaceRole({
                            organizationId,
                            workspaceId,
                            email: user.email,
                            role: item.role_name,
                        }),
                    ),
            )
            await refetch()
            message.success("Workspace role updated")
        } catch (error) {
            console.error("Failed to change the role:", error)
            message.error("Failed to update workspace role")
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            {role && (
                <Tooltip title={role.role_description}>
                    <Tag icon={loading && <SyncOutlined spin />}>
                        {snakeToTitle(role.role_name)}
                    </Tag>
                </Tooltip>
            )}
            {!readOnly && !loading && canModifyRoles && (
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        selectedKeys: [role?.role_name],
                        items: roles.map((role) => ({
                            key: role.role_name,
                            label: (
                                <Space orientation="vertical" size={0}>
                                    <Typography.Text className="text-sm">
                                        {snakeToTitle(role.role_name || "")}
                                    </Typography.Text>
                                    <Typography.Text type="secondary">
                                        {role.role_description}
                                    </Typography.Text>
                                </Space>
                            ),
                            onClick: () => handleChangeRole(role.role_name),
                        })),
                    }}
                >
                    <EditOutlined style={{cursor: "pointer"}} />
                </Dropdown>
            )}
        </>
    )
}

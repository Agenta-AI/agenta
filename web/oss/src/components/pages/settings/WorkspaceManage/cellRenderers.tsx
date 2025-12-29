import {useState} from "react"

import {EditOutlined, MoreOutlined, SyncOutlined} from "@ant-design/icons"
import {ArrowClockwise, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Modal, Space, Tag, Tooltip, Typography} from "antd"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {message} from "@/oss/components/AppMessageContext"
import {useSubscriptionDataWrapper} from "@/oss/lib/helpers/useSubscriptionDataWrapper"
import {snakeToTitle} from "@/oss/lib/helpers/utils"
import {isEE, isEmailInvitationsEnabled} from "@/oss/lib/helpers/isEE"
import {Plan, User} from "@/oss/lib/Types"
import {WorkspaceMember} from "@/oss/lib/Types"
import {
    assignWorkspaceRole,
    removeFromWorkspace,
    resendInviteToWorkspace,
    unAssignWorkspaceRole,
} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {updateUsername} from "@/oss/services/profile"
import {useWorkspaceRoles} from "@/oss/state/workspace"

export const Actions: React.FC<{
    member: WorkspaceMember
    hidden?: boolean
    organizationId: string
    workspaceId: string
    onResendInvite: any
    selfMenu?: boolean
}> = ({member, hidden, organizationId, workspaceId, onResendInvite, selfMenu}) => {
    const {user} = member
    const isMember = user.status === "member"

    const [resendLoading, setResendLoading] = useState(false)
    const {refetch} = useOrgData()
    const {refetch: refetchProfile} = useProfileData()
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameValue, setRenameValue] = useState(user.username || "")

    if (hidden && !selfMenu) return null

    const handleResendInvite = () => {
        if (!organizationId || !user.email || !workspaceId) return
        setResendLoading(true)
        resendInviteToWorkspace({organizationId, workspaceId, email: user.email})
            .then((res) => {
                if (!isEmailInvitationsEnabled() && typeof res.url === "string") {
                    onResendInvite({email: user.email, uri: res.url})
                } else {
                    message.success("Invitation sent!")
                }
            })
            .then(() => refetch())
            .catch(console.error)
            .finally(() => setResendLoading(false))
    }

    const handleRemove = () => {
        if (!organizationId || !user.email || !workspaceId) return
        AlertPopup({
            title: "Remove member",
            message: `Are you sure you want to remove ${user.username} from this workspace?`,
            onOk: () =>
                removeFromWorkspace({organizationId, workspaceId, email: user.email}, true).then(
                    () => refetch(),
                ),
            okText: "Remove",
        })
    }

    const handleRename = async () => {
        const nextValue = renameValue.trim()
        if (!nextValue) {
            message.error("Username is required.")
            return
        }

        try {
            await updateUsername(nextValue)
            await Promise.all([refetchProfile(), refetch()])
            message.success("Username updated")
            setRenameOpen(false)
        } catch (error: any) {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to update username"
            message.error(detail)
        }
    }

    return (
        <>
            <Dropdown
                trigger={["click"]}
                styles={{
                    root: {
                        width: 180,
                    },
                }}
                menu={{
                    items: selfMenu
                        ? [
                              {
                                  key: "rename",
                                  label: "Rename",
                                  icon: <EditOutlined />,
                                  onClick: (e: any) => {
                                      e.domEvent.stopPropagation()
                                      setRenameValue(user.username || "")
                                      setRenameOpen(true)
                                  },
                              },
                          ]
                        : [
                              ...(!isMember
                                  ? [
                                        {
                                            key: "resend_invite",
                                            label: "Resend invitation",
                                            icon: <ArrowClockwise size={16} />,
                                            onClick: (e: any) => {
                                                e.domEvent.stopPropagation()
                                                handleResendInvite()
                                            },
                                        },
                                    ]
                                  : []),
                              {
                                  key: "remove",
                                  label: "Remove",
                                  icon: <Trash size={16} />,
                                  danger: true,
                                  onClick: (e) => {
                                      e.domEvent.stopPropagation()
                                      handleRemove()
                                  },
                              },
                          ],
                }}
            >
                <Button
                    onClick={(e) => e.stopPropagation()}
                    type="text"
                    icon={<MoreOutlined />}
                    loading={resendLoading}
                />
            </Dropdown>

            <Modal
                title="Rename your username"
                open={renameOpen}
                okText="Save"
                onCancel={() => setRenameOpen(false)}
                onOk={handleRename}
                confirmLoading={false}
                destroyOnHidden
                centered
            >
                <Input
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    placeholder="New username"
                />
            </Modal>
        </>
    )
}

export const Roles: React.FC<{
    member: WorkspaceMember
    signedInUser: User
    organizationId: string
    workspaceId: string
}> = ({member, signedInUser, organizationId, workspaceId}) => {
    const [loading, setLoading] = useState(false)
    const {roles} = useWorkspaceRoles()
    const {selectedOrg, refetch} = useOrgData()
    const {subscription}: {subscription?: any} = useSubscriptionDataWrapper() ?? {
        subscription: undefined,
    }

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
            {!readOnly && !loading && isEE() && subscription?.plan === Plan.Business && (
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

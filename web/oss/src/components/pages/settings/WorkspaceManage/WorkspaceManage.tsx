import {useMemo, useState, type FC} from "react"

import {GearSix, Plus} from "@phosphor-icons/react"
import {Button, Input, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {isEmailInvitationsEnabled, isEE} from "@/oss/lib/helpers/isEE"
import {getUsernameFromEmail} from "@/oss/lib/helpers/utils"
import {WorkspaceMember} from "@/oss/lib/Types"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useWorkspaceMembers} from "@/oss/state/workspace"

import AvatarWithLabel from "./assets/AvatarWithLabel"
import {Actions, Roles} from "./cellRenderers"

const InvitedUserLinkModal = dynamic(() => import("./Modals/InvitedUserLinkModal"), {ssr: false})
const InviteUsersModal = dynamic(() => import("./Modals/InviteUsersModal"), {ssr: false})

const WorkspaceManage: FC = () => {
    const {user: signedInUser} = useProfileData()
    const {selectedOrg, loading, refetch} = useOrgData()
    const {filteredMembers, searchTerm, setSearchTerm} = useWorkspaceMembers()
    const {hasRBAC} = useEntitlements()
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isInvitedUserLinkModalOpen, setIsInvitedUserLinkModalOpen] = useState(false)
    const [invitedUserData, setInvitedUserData] = useState<{email: string; uri: string}>({
        email: "",
        uri: "",
    })
    const [queryInviteModalOpen, setQueryInviteModalOpen] = useQueryParam("inviteModal")

    const organizationId = selectedOrg?.id
    const workspaceId = selectedOrg?.default_workspace?.id

    // Check if current user can invite members (owner or workspace_admin only)
    const canInviteMembers = useMemo(() => {
        if (!isEE()) return true // OSS mode - allow all
        if (!hasRBAC) return true // No RBAC - allow all

        // Check if user is organization owner
        if (selectedOrg?.owner_id && signedInUser?.id === selectedOrg.owner_id) {
            return true
        }

        const currentMember = filteredMembers.find(
            (member) => member.user?.id === signedInUser?.id || member.user?.email === signedInUser?.email
        )

        if (!currentMember) return false

        const allowedRoles = ["owner", "workspace_admin"]
        return currentMember.roles?.some((role) => allowedRoles.includes(role.role_name))
    }, [filteredMembers, signedInUser, hasRBAC, selectedOrg])

    const columns = useMemo(
        () =>
            (
                [
                    {
                        dataIndex: ["user", "username"],
                        key: "username",
                        title: "Name",
                        onHeaderCell: () => ({
                            style: {minWidth: 180},
                        }),
                        render: (_, member) => {
                            const {user} = member
                            const name = user.username || getUsernameFromEmail(user.email)
                            return (
                                <Space>
                                    <AvatarWithLabel name={name} />
                                    {user.email === signedInUser?.email && (
                                        <Tag color="processing">you</Tag>
                                    )}
                                </Space>
                            )
                        },
                    },
                    {
                        dataIndex: ["user", "email"],
                        key: "email",
                        title: "Email",
                        render: (_, member) => (
                            <span className="font-mono text-xs">{member.user?.email}</span>
                        ),
                    },
                    isEE() && hasRBAC
                        ? {
                              dataIndex: "roles",
                              key: "role",
                              title: "Roles",
                              render: (_, member) => (
                                  <Roles
                                      member={member}
                                      signedInUser={signedInUser!}
                                      organizationId={organizationId!}
                                      workspaceId={workspaceId!}
                                  />
                              ),
                          }
                        : null,
                    {
                        dataIndex: ["user", "created_at"],
                        key: "created_at",
                        title: "Creation Date",
                        onHeaderCell: () => ({
                            style: {minWidth: 160},
                        }),
                        render: (_, member) => {
                            const {user} = member

                            const isMember = !("status" in user) || user.status === "member"
                            let color = "warning"
                            let text = "Invitation Pending"
                            if (user.status === "expired") {
                                color = "error"
                                text = "Invitation Expired"
                            }
                            return (
                                <Space orientation="vertical">
                                    <Typography.Text>
                                        {formatDay({date: user.created_at})}
                                    </Typography.Text>
                                    {!isMember && <Tag color={color}>{text}</Tag>}
                                </Space>
                            )
                        },
                    },
                    {
                        title: <GearSix size={16} />,
                        key: "key",
                        width: 61,
                        fixed: "right",
                        align: "center",
                        render: (_, member) => {
                            const isSelf =
                                member.user?.id === signedInUser?.id ||
                                member.user?.email === signedInUser?.email
                            const isOwner = member.user?.id === selectedOrg?.owner_id
                            return (
                                <Actions
                                    member={member}
                                    hidden={!isSelf && isOwner}
                                    selfMenu={isSelf}
                                    organizationId={organizationId!}
                                    workspaceId={workspaceId!}
                                    onResendInvite={(data: any) => {
                                        if (!isEmailInvitationsEnabled() && data.uri) {
                                            setInvitedUserData(data)
                                            setIsInvitedUserLinkModalOpen(true)
                                        }
                                    }}
                                />
                            )
                        },
                    },
                ] as ColumnsType<WorkspaceMember>
            ).filter(Boolean),
        [selectedOrg?.id],
    )

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                {canInviteMembers && (
                    <Button
                        type="primary"
                        icon={<Plus size={14} className="mt-0.2" />}
                        onClick={() => setIsInviteModalOpen(true)}
                    >
                        Invite Members
                    </Button>
                )}

                <Input.Search
                    placeholder="Search"
                    className="w-[400px]"
                    allowClear
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <Spin spinning={loading}>
                <Table<WorkspaceMember>
                    dataSource={filteredMembers}
                    rowKey={(record) => record.user.id}
                    columns={columns}
                    pagination={false}
                    bordered
                    scroll={{x: true}}
                />
            </Spin>

            <InviteUsersModal
                setQueryInviteModalOpen={setQueryInviteModalOpen}
                open={queryInviteModalOpen === "open" || isInviteModalOpen}
                onCancel={() => setIsInviteModalOpen(false)}
                workspaceId={workspaceId!}
                onSuccess={(data) => {
                    if (!isEmailInvitationsEnabled() && data?.uri) {
                        setInvitedUserData(data)
                        setIsInvitedUserLinkModalOpen(true)
                    }
                }}
            />
            {!isEmailInvitationsEnabled() && (
                <InvitedUserLinkModal
                    open={isInvitedUserLinkModalOpen}
                    onCancel={() => {
                        setIsInvitedUserLinkModalOpen(false)
                        refetch()
                    }}
                    invitedUserData={invitedUserData}
                />
            )}
        </section>
    )
}

export default WorkspaceManage

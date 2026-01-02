import {useMemo, useState, type FC} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {GearSix, Plus} from "@phosphor-icons/react"
import {Button, Input, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {isEmailInvitationsEnabled, isEE} from "@/oss/lib/helpers/isEE"
import {getUsernameFromEmail, isDemo} from "@/oss/lib/helpers/utils"
import {WorkspaceMember} from "@/oss/lib/Types"
import {useOrgData, isPersonalOrg} from "@/oss/state/org"
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
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isInvitedUserLinkModalOpen, setIsInvitedUserLinkModalOpen] = useState(false)
    const [invitedUserData, setInvitedUserData] = useState<{email: string; uri: string}>({
        email: "",
        uri: "",
    })
    const [queryInviteModalOpen, setQueryInviteModalOpen] = useQueryParam("inviteModal")

    const organizationId = selectedOrg?.id
    const workspaceId = selectedOrg?.default_workspace?.id

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
                    isDemo()
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

    // Check if organization is personal and show empty state in EE
    const showPersonalOrgMessage = isEE() && isPersonalOrg(selectedOrg)

    if (showPersonalOrgMessage) {
        return (
            <section className="flex flex-col items-center justify-center gap-6 py-20 min-h-[400px]">
                <div className="flex flex-col items-center gap-4 text-center max-w-lg px-6 py-8 bg-gray-50 rounded-lg border border-gray-200">
                    <Typography.Title level={4} className="!mb-0">
                        This is your Personal Organization.
                    </Typography.Title>
                    <Typography.Text type="secondary" className="text-base leading-relaxed">
                        To invite team members and manage roles
                        <br />
                        please create or switch to a collaborative organization.
                    </Typography.Text>
                    <Typography.Text type="secondary" className="text-sm">
                        Click on your organization in the sidebar
                        <br />
                        to create a new organization or switch to an existing one.
                    </Typography.Text>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        size="large"
                        className="mt-2"
                        onClick={() => {
                            window.dispatchEvent(new Event("open-create-organization"))
                        }}
                    >
                        New Organization
                    </Button>
                </div>
            </section>
        )
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Button
                    type="primary"
                    icon={<Plus size={14} className="mt-0.2" />}
                    onClick={() => setIsInviteModalOpen(true)}
                >
                    Invite members
                </Button>

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

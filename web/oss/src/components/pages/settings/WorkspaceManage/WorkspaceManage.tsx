import {useEffect, useMemo, useState, type FC} from "react"

import {GearSix, PencilSimple, Plus} from "@phosphor-icons/react"
import {Button, Input, Space, Spin, Table, Tag, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {getUsernameFromEmail, isDemo} from "@/oss/lib/helpers/utils"
import {WorkspaceMember} from "@/oss/lib/Types"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useUpdateWorkspaceName, useWorkspaceMembers} from "@/oss/state/workspace"

import AvatarWithLabel from "./assets/AvatarWithLabel"
import {Actions, Roles} from "./cellRenderers"

const InvitedUserLinkModal = dynamic(() => import("./Modals/InvitedUserLinkModal"), {ssr: false})
const InviteUsersModal = dynamic(() => import("./Modals/InviteUsersModal"), {ssr: false})

const WorkspaceManage: FC = () => {
    const {user: signedInUser} = useProfileData()
    const {selectedOrg, loading, refetch} = useOrgData()
    const {updateWorkspaceName} = useUpdateWorkspaceName()
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
    const workspace = selectedOrg?.default_workspace

    const [isEditingName, setIsEditingName] = useState(false)
    const [workspaceNameInput, setWorkspaceNameInput] = useState(workspace?.name || "")

    useEffect(() => {
        setWorkspaceNameInput(workspace?.name || "")
    }, [workspace?.name])

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
                            return (
                                <Actions
                                    member={member}
                                    hidden={
                                        member.user.email === signedInUser?.email ||
                                        member.user.id === selectedOrg?.owner
                                    }
                                    organizationId={organizationId!}
                                    workspaceId={workspaceId!}
                                    onResendInvite={(data: any) => {
                                        if (!isDemo() && data.uri) {
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

    const handleSaveWorkspaceName = async () => {
        if (!workspaceId || !organizationId) return

        await updateWorkspaceName({
            organizationId,
            workspaceId,
            name: workspaceNameInput,
            onSuccess: () => {
                // Only handle UI state - workspace data is updated by the mutation atom
                setIsEditingName(false)
            },
        })
    }

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 group">
                {!isEditingName ? (
                    <>
                        <Typography.Text className="font-medium" data-cy="workspace-name">
                            {workspace?.name}
                        </Typography.Text>
                        <Button
                            type="text"
                            size="small"
                            className="opacity-0 group-hover:opacity-100"
                            icon={<PencilSimple size={14} />}
                            onClick={() => setIsEditingName(true)}
                        />
                    </>
                ) : (
                    <>
                        <Input
                            value={workspaceNameInput}
                            onChange={(e) => setWorkspaceNameInput(e.target.value)}
                            className="w-[250px]"
                            autoFocus
                        />
                        <Button type="primary" size="small" onClick={handleSaveWorkspaceName}>
                            Save
                        </Button>
                        <Button
                            size="small"
                            onClick={() => {
                                setIsEditingName(false)
                                setWorkspaceNameInput(workspace?.name || "")
                            }}
                        >
                            Cancel
                        </Button>
                    </>
                )}
            </div>
            <div className="flex items-center justify-between gap-2">
                <Input.Search
                    placeholder="Search"
                    className="w-[400px]"
                    allowClear
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />

                <Button
                    type="primary"
                    icon={<Plus size={14} className="mt-0.2" />}
                    onClick={() => setIsInviteModalOpen(true)}
                >
                    Invite members
                </Button>
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
                    if (!isDemo() && data?.uri) {
                        setInvitedUserData(data)
                        setIsInvitedUserLinkModalOpen(true)
                    }
                }}
            />
            {!isDemo() && (
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

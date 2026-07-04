import {useMemo, useState, type FC} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {Input} from "@agenta/primitive-ui/components/input"
import {GearSix, Plus} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {useQueryParam} from "@/oss/hooks/useQuery"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {isEmailInvitationsEnabled, isEE} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
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
    const {canInviteMembers} = useWorkspacePermissions()
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isInvitedUserLinkModalOpen, setIsInvitedUserLinkModalOpen] = useState(false)
    const [invitedUserData, setInvitedUserData] = useState<{email: string; uri: string}>({
        email: "",
        uri: "",
    })
    const [queryInviteModalOpen, setQueryInviteModalOpen] = useQueryParam("inviteModal")

    const organizationId = selectedOrg?.id
    const workspaceId = selectedOrg?.default_workspace?.id

    const columns = useMemo<ColumnDef<WorkspaceMember, unknown>[]>(() => {
        const roleColumns: ColumnDef<WorkspaceMember, unknown>[] =
            !isEE() || hasRBAC
                ? [
                      {
                          id: "role",
                          accessorFn: (member) => member.roles,
                          header: "Roles",
                          enableSorting: false,
                          cell: ({row}) => (
                              <Roles
                                  member={row.original}
                                  signedInUser={signedInUser!}
                                  organizationId={organizationId!}
                                  workspaceId={workspaceId!}
                              />
                          ),
                      },
                  ]
                : []

        return [
            {
                id: "username",
                accessorFn: (member) => member.user.username,
                header: "Name",
                size: 180,
                enableSorting: false,
                cell: ({row}) => {
                    const member = row.original
                    const {user} = member
                    const name = user.username || getUsernameFromEmail(user.email)
                    return (
                        <div className="flex items-center gap-2">
                            <AvatarWithLabel name={name} />
                            {user.email === signedInUser?.email && (
                                <Badge variant="secondary">you</Badge>
                            )}
                        </div>
                    )
                },
            },
            {
                id: "email",
                accessorFn: (member) => member.user.email,
                header: "Email",
                enableSorting: false,
                cell: ({row}) => (
                    <span className="font-mono text-xs">{row.original.user?.email}</span>
                ),
            },
            ...roleColumns,
            {
                id: "created_at",
                accessorFn: (member) => member.user.created_at,
                header: "Creation Date",
                size: 160,
                enableSorting: false,
                cell: ({row}) => {
                    const member = row.original
                    const {user} = member

                    const isMember = !("status" in user) || user.status === "member"
                    let color = "warning"
                    let text = "Invitation Pending"
                    if (user.status === "expired") {
                        color = "error"
                        text = "Invitation Expired"
                    }
                    return (
                        <div className="flex flex-col gap-1">
                            <span>{formatDay({date: user.created_at})}</span>
                            {!isMember && (
                                <Badge variant={color === "error" ? "destructive" : "outline"}>
                                    {text}
                                </Badge>
                            )}
                        </div>
                    )
                },
            },
            {
                id: "actions",
                header: () => <GearSix size={16} className="mx-auto" />,
                size: 61,
                enableSorting: false,
                cell: ({row}) => {
                    const member = row.original
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
                            onResendInvite={(data) => {
                                if (!isEmailInvitationsEnabled() && data.uri) {
                                    setInvitedUserData(data)
                                    setIsInvitedUserLinkModalOpen(true)
                                }
                            }}
                        />
                    )
                },
            },
        ]
    }, [selectedOrg?.id])

    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                {canInviteMembers && (
                    <Button size="sm" onClick={() => setIsInviteModalOpen(true)}>
                        <Plus size={14} className="mt-0.2" />
                        Invite Members
                    </Button>
                )}

                <Input
                    type="search"
                    placeholder="Search"
                    className="w-[400px]"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            <DataTable<WorkspaceMember>
                data={filteredMembers}
                getRowId={(member) => member.user.id}
                columns={columns}
                loading={loading}
                enableSorting={false}
            />

            <InviteUsersModal
                setQueryInviteModalOpen={setQueryInviteModalOpen}
                open={queryInviteModalOpen === "open" || isInviteModalOpen}
                onClose={() => setIsInviteModalOpen(false)}
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
                    onClose={() => {
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

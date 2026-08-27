import {useCallback, useState, type FC} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {removeFromWorkspace, resendInviteToWorkspace} from "@agenta/entities/organization"
import {resetPassword} from "@agenta/entities/profile"
import {MembersPage} from "@agenta/settings-ui"
import {isEE, isEmailInvitationsEnabled} from "@agenta/shared/api"
import {message} from "@agenta/ui/app-message"
import {Input, Modal} from "antd"
import dynamic from "next/dynamic"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {updateUsername} from "@/oss/services/profile"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useWorkspaceMembers} from "@/oss/state/workspace"

import {Roles} from "./cellRenderers"

const GenerateResetLinkModal = dynamic(() => import("./Modals/GenerateResetLinkModal"), {
    ssr: false,
})
const PasswordResetLinkModal = dynamic(() => import("./Modals/PasswordResetLinkModal"), {
    ssr: false,
})
const InvitedUserLinkModal = dynamic(() => import("./Modals/InvitedUserLinkModal"), {ssr: false})
const InviteUsersModal = dynamic(() => import("./Modals/InviteUsersModal"), {ssr: false})

/** OSS binding: the shared members table with this app's antd dialogs and its role editor. */
const WorkspaceManage: FC = () => {
    const {user: signedInUser, refetch: refetchProfile} = useProfileData()
    const {selectedOrg, loading, refetch} = useOrgData()
    const {members, searchTerm, setSearchTerm} = useWorkspaceMembers()
    const {hasRBAC} = useEntitlements()
    const {canInviteMembers, canRemoveMembers, canModifyRoles} = useWorkspacePermissions()
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const [isInvitedUserLinkModalOpen, setIsInvitedUserLinkModalOpen] = useState(false)
    const [invitedUserData, setInvitedUserData] = useState<{email: string; uri: string}>({
        email: "",
        uri: "",
    })
    const [queryInviteModalOpen, setQueryInviteModalOpen] = useQueryParam("inviteModal")
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameValue, setRenameValue] = useState("")
    const [resendingEmail, setResendingEmail] = useState<string | null>(null)
    const [resetTarget, setResetTarget] = useState<{id: string; username?: string} | null>(null)
    const [generateResetLinkOpen, setGenerateResetLinkOpen] = useState(false)
    const [resetLinkOpen, setResetLinkOpen] = useState(false)
    const [resetLink, setResetLink] = useState("")
    const [resetLoading, setResetLoading] = useState(false)

    // Mirrors the backend RESET_PASSWORD permission, granted with invite/role-modify rights.
    const canResetPassword = canInviteMembers || canModifyRoles

    const organizationId = selectedOrg?.id
    const workspaceId = selectedOrg?.default_workspace?.id

    const handleResendInvite = useCallback(
        (record: WorkspaceMember) => {
            const {user} = record
            if (!organizationId || !user.email || !workspaceId) return
            setResendingEmail(user.email)
            resendInviteToWorkspace({organizationId, workspaceId, email: user.email})
                .then((res) => {
                    if (!isEmailInvitationsEnabled() && typeof res.url === "string") {
                        setInvitedUserData({email: user.email!, uri: res.url})
                        setIsInvitedUserLinkModalOpen(true)
                    } else {
                        message.success("Invitation sent!")
                    }
                })
                .then(() => refetch())
                .catch(console.error)
                .finally(() => setResendingEmail(null))
        },
        [organizationId, workspaceId, refetch],
    )

    const handleRemove = useCallback(
        (record: WorkspaceMember) => {
            const {user} = record
            if (!organizationId || !user.email || !workspaceId) return
            AlertPopup({
                title: "Remove member",
                message: `Are you sure you want to remove ${user.username} from this organization?`,
                okText: "Remove",
                onOk: () =>
                    removeFromWorkspace(
                        {organizationId, workspaceId, email: user.email},
                        true,
                    ).then(() => refetch()),
            })
        },
        [organizationId, workspaceId, refetch],
    )

    const handleRename = useCallback(async () => {
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
        } catch (error) {
            const detail = (error as {response?: {data?: {detail?: string}}; message?: string})
                ?.response?.data?.detail
            message.error(
                detail || (error as {message?: string})?.message || "Unable to update username",
            )
        }
    }, [renameValue, refetchProfile, refetch])

    const handleResetPassword = useCallback(async () => {
        if (!resetTarget) return
        setResetLoading(true)
        try {
            const link = await resetPassword(resetTarget.id)
            setGenerateResetLinkOpen(false)
            setResetLink(link)
            setResetLinkOpen(true)
        } catch (error) {
            const detail = (error as {response?: {data?: {detail?: string}}})?.response?.data
                ?.detail
            message.error(
                detail ||
                    (error as {message?: string})?.message ||
                    "Unable to generate reset password link",
            )
        } finally {
            setResetLoading(false)
        }
    }, [resetTarget])

    return (
        <MembersPage
            members={members}
            loading={loading}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            signedInUser={signedInUser}
            ownerId={selectedOrg?.owner_id}
            canInviteMembers={canInviteMembers}
            canRemoveMembers={canRemoveMembers}
            canResetPassword={canResetPassword}
            resendingEmail={resendingEmail}
            // The role editor writes through antd's Select, so it stays with this host.
            renderRoleCell={
                !isEE() || hasRBAC
                    ? (member) => (
                          <Roles
                              member={member}
                              signedInUser={signedInUser!}
                              organizationId={organizationId!}
                              workspaceId={workspaceId!}
                          />
                      )
                    : undefined
            }
            onInvite={() => setIsInviteModalOpen(true)}
            onResendInvite={handleResendInvite}
            onRemove={handleRemove}
            onRenameSelf={(member) => {
                setRenameValue(member.user.username || "")
                setRenameOpen(true)
            }}
            onResetPassword={(member) => {
                setResetTarget({id: member.user.id, username: member.user.username})
                setGenerateResetLinkOpen(true)
            }}
        >
            <Modal
                title="Rename your username"
                open={renameOpen}
                okText="Save"
                onCancel={() => setRenameOpen(false)}
                onOk={handleRename}
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

            <GenerateResetLinkModal
                open={generateResetLinkOpen}
                username={resetTarget?.username}
                onCancel={() => setGenerateResetLinkOpen(false)}
                onOk={handleResetPassword}
                confirmLoading={resetLoading}
            />

            <PasswordResetLinkModal
                open={resetLinkOpen}
                username={resetTarget?.username}
                generatedLink={resetLink}
                onCancel={() => setResetLinkOpen(false)}
            />

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
        </MembersPage>
    )
}

export default WorkspaceManage

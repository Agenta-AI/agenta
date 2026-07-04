import {useState} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Input} from "@agenta/primitive-ui/components/input"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {toast} from "@agenta/primitive-ui/lib/toast"
import type {User} from "@agenta/shared/types"
import {ArrowClockwise, Check, DotsThree, PencilSimple, Trash} from "@phosphor-icons/react"

import ConfirmDialog, {type ConfirmRequest} from "@/oss/components/ConfirmDialog"
import {useWorkspacePermissions} from "@/oss/hooks/useWorkspacePermissions"
import {isEmailInvitationsEnabled} from "@/oss/lib/helpers/isEE"
import {snakeToTitle} from "@/oss/lib/helpers/utils"
import {WorkspaceMember} from "@/oss/lib/Types"
import {updateUsername} from "@/oss/services/profile"
import {
    assignWorkspaceRole,
    removeFromWorkspace,
    resendInviteToWorkspace,
    unAssignWorkspaceRole,
} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useProfileData} from "@/oss/state/profile"
import {useWorkspaceRoles} from "@/oss/state/workspace"

interface ActionsProps {
    member: WorkspaceMember
    hidden?: boolean
    organizationId: string
    workspaceId: string
    onResendInvite: (data: {email: string; uri: string}) => void
    selfMenu?: boolean
}

export const Actions: React.FC<ActionsProps> = ({
    member,
    hidden,
    organizationId,
    workspaceId,
    onResendInvite,
    selfMenu,
}) => {
    const {user} = member
    const isMember = user.status === "member"
    const {canModifyRoles, canInviteMembers} = useWorkspacePermissions()
    const [resendLoading, setResendLoading] = useState(false)
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameValue, setRenameValue] = useState(user.username || "")
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
    const {refetch} = useOrgData()
    const {refetch: refetchProfile} = useProfileData()

    if (hidden && !selfMenu) return null
    if (!selfMenu && !canInviteMembers && !canModifyRoles) return null

    const handleResendInvite = () => {
        if (!organizationId || !user.email || !workspaceId) return
        setResendLoading(true)
        resendInviteToWorkspace({organizationId, workspaceId, email: user.email})
            .then((res) => {
                if (!isEmailInvitationsEnabled() && typeof res.url === "string") {
                    onResendInvite({email: user.email, uri: res.url})
                } else {
                    toast.success("Invitation sent!")
                }
            })
            .then(() => refetch())
            .catch(console.error)
            .finally(() => setResendLoading(false))
    }

    const handleRemove = () => {
        if (!organizationId || !user.email || !workspaceId) return
        setConfirm({
            title: "Remove member",
            message: `Are you sure you want to remove ${user.username} from this workspace?`,
            okText: "Remove",
            danger: true,
            onOk: () =>
                removeFromWorkspace({organizationId, workspaceId, email: user.email}, true).then(
                    () => refetch(),
                ),
        })
    }

    const handleRename = async () => {
        const nextValue = renameValue.trim()
        if (!nextValue) {
            toast.error("Username is required.")
            return
        }

        try {
            await updateUsername(nextValue)
            await Promise.all([refetchProfile(), refetch()])
            toast.success("Username updated")
            setRenameOpen(false)
        } catch (error: any) {
            const detail =
                error?.response?.data?.detail || error?.message || "Unable to update username"
            toast.error(detail)
        }
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Member actions"
                            onClick={(event) => event.stopPropagation()}
                            disabled={resendLoading}
                        />
                    }
                >
                    {resendLoading ? <Spinner /> : <DotsThree />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    {selfMenu ? (
                        <DropdownMenuItem
                            onClick={(event) => {
                                event.stopPropagation()
                                setRenameValue(user.username || "")
                                setRenameOpen(true)
                            }}
                        >
                            <PencilSimple />
                            Rename
                        </DropdownMenuItem>
                    ) : (
                        <>
                            {!isMember && canInviteMembers && (
                                <DropdownMenuItem
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        handleResendInvite()
                                    }}
                                >
                                    <ArrowClockwise />
                                    Resend invitation
                                </DropdownMenuItem>
                            )}
                            {canModifyRoles && (
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        handleRemove()
                                    }}
                                >
                                    <Trash />
                                    Remove
                                </DropdownMenuItem>
                            )}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename your username</DialogTitle>
                    </DialogHeader>
                    <Input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        placeholder="New username"
                        onKeyDown={(event) => {
                            if (event.key === "Enter") handleRename()
                        }}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setRenameOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleRename}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
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
            toast.success("Workspace role updated")
        } catch (error) {
            console.error("Failed to change the role:", error)
            toast.error("Failed to update workspace role")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center gap-1">
            {role && (
                <Tooltip>
                    <TooltipTrigger render={<Badge variant="outline" />}>
                        {loading ? <Spinner className="size-3" /> : null}
                        {snakeToTitle(role.role_name)}
                    </TooltipTrigger>
                    <TooltipContent>{role.role_description}</TooltipContent>
                </Tooltip>
            )}
            {!readOnly && !loading && canModifyRoles && (
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon-sm" aria-label="Change role" />}
                    >
                        <PencilSimple />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                        {roles.map((roleOption) => (
                            <DropdownMenuItem
                                key={roleOption.role_name}
                                onClick={() => handleChangeRole(roleOption.role_name)}
                            >
                                <div className="flex flex-1 flex-col">
                                    <span className="text-sm">
                                        {snakeToTitle(roleOption.role_name || "")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {roleOption.role_description}
                                    </span>
                                </div>
                                {roleOption.role_name === role?.role_name ? <Check /> : null}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    )
}

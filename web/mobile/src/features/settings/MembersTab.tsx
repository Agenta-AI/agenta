import {useState} from "react"

import {isValidEmailAddress} from "@agenta/auth"
import {projectPermissionQueryPrefix} from "@agenta/entities/access"
import type {WorkspaceMember} from "@agenta/entities/organization"
import {
    assignWorkspaceRole,
    fetchOfferedRoles,
    inviteToWorkspace,
    removeFromWorkspace,
} from "@agenta/entities/organization"
import {updateUsername, useProfile} from "@agenta/entities/profile"
import {MembersPage} from "@agenta/settings-ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query"

import {useProjectPermission} from "../context/useProjectPermission"

import {InvitedLinkDialog, type InvitedLink} from "./InvitedLinkDialog"
import {memberRole, MemberRoleCell, memberRoleLabel} from "./MemberRoleCell"
import type {SettingsTabProps} from "./settingsTabProps"
import {useSettingsOrg} from "./useSettingsOrg"

/** Mobile binding for Members: invite and remove as dialogs, your own name renamed in place. */
export const MembersTab = ({workspaceId: routeWorkspaceId, projectId}: SettingsTabProps) => {
    const {user: signedInUser} = useProfile()
    const {organizationId, org, loading, failed, retry} = useSettingsOrg(routeWorkspaceId)
    const members = org.data?.default_workspace?.members ?? []
    const ownerId = org.data?.owner_id
    const workspaceId = org.data?.default_workspace?.id
    const onChanged = () => void org.refetch()
    const [inviteOpen, setInviteOpen] = useState(false)
    const [email, setEmail] = useState("")
    const [role, setRole] = useState("")
    const [emailTouched, setEmailTouched] = useState(false)
    const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null)
    const [error, setError] = useState<string | null>(null)
    // A role change happens on the table, not in a dialog, so its failure is said there.
    const [roleError, setRoleError] = useState<string | null>(null)
    const [invitedLink, setInvitedLink] = useState<InvitedLink | null>(null)
    const queryClient = useQueryClient()

    // Knowing the workspace is the floor; each verb below also asks the backend what this
    // reader may do, so no control appears that the API would refuse.
    const scopeKnown = Boolean(organizationId && workspaceId)
    const canInvite = useProjectPermission(projectId, "add_new_user_to_workspace")
    const canChangeRoles = useProjectPermission(projectId, "modify_user_roles")
    // The remove route requires the admin role itself (or the organization owner), whatever
    // permissions a custom role holds, so this reads the reader's own role.
    const signedInMember = members.find((member) => member.user.id === signedInUser?.id)
    const canRemove =
        (Boolean(ownerId) && signedInUser?.id === ownerId) ||
        (signedInMember ? ["admin", "owner"].includes(memberRole(signedInMember)) : false)

    // The roles this organization offers, which is what an invite and a role change may set.
    // Keyed by organization, because another organization on another plan offers another set.
    const roles = useQuery({
        queryKey: ["offered-roles", organizationId, projectId],
        queryFn: () => fetchOfferedRoles(projectId, true),
        enabled: Boolean(projectId) && (inviteOpen || canChangeRoles),
    })
    const offeredRoles = (roles.data ?? []).map((entry) => entry.role_name)

    const emailValid = isValidEmailAddress(email.trim())
    const showEmailError = emailTouched && Boolean(email.trim()) && !emailValid
    // A role is required wherever the API offers roles; still loading counts as offered.
    const roleMissing = (roles.isPending || offeredRoles.length > 0) && !role

    const closeInvite = () => {
        setInviteOpen(false)
        setEmail("")
        setRole("")
        setEmailTouched(false)
        setError(null)
    }

    const inviteMutation = useMutation({
        mutationFn: (invitedEmail: string) =>
            inviteToWorkspace({
                organizationId: organizationId!,
                workspaceId: workspaceId!,
                data: [{email: invitedEmail, ...(role ? {roles: [role]} : {})}],
            }),
        onSuccess: (response: {url?: unknown}, invitedEmail) => {
            if (typeof response?.url === "string") {
                setInvitedLink({email: invitedEmail, url: response.url})
            }
            closeInvite()
            onChanged()
        },
        onError: (cause: unknown) =>
            setError((cause as Error)?.message || "Unable to send the invitation"),
    })

    const removeMutation = useMutation({
        mutationFn: (member: WorkspaceMember) =>
            removeFromWorkspace(
                {
                    organizationId: organizationId!,
                    workspaceId: workspaceId!,
                    email: member.user.email,
                },
                true,
            ),
        onSuccess: () => {
            setPendingRemoval(null)
            onChanged()
        },
        onError: (cause: unknown) =>
            setError((cause as Error)?.message || "Unable to remove the member"),
    })

    const roleMutation = useMutation({
        mutationFn: ({member, role: next}: {member: WorkspaceMember; role: string}) =>
            assignWorkspaceRole(
                {
                    organizationId: organizationId!,
                    workspaceId: workspaceId!,
                    email: member.user.email,
                    role: next,
                },
                true,
            ),
        onSuccess: () => {
            onChanged()
            // The change can be the reader's own role (an admin who makes themself a member):
            // every cached permission answer, the trace gate included, must be asked again.
            void queryClient.invalidateQueries({queryKey: projectPermissionQueryPrefix})
        },
        // The API's refusal is a sentence written for the reader ("This role is not available on
        // your plan."); anything else gets the plain fallback, never the transport's own text.
        onError: (cause: unknown) => {
            const detail = (cause as {response?: {data?: {detail?: unknown}}})?.response?.data
                ?.detail
            setRoleError(typeof detail === "string" ? detail : "Unable to change the role")
        },
    })

    if (failed)
        return <LoadError title="Could not load this organization's members" onRetry={retry} />

    return (
        <MembersPage
            members={members}
            loading={loading}
            signedInUser={signedInUser}
            ownerId={ownerId}
            canInviteMembers={scopeKnown && canInvite}
            canRemoveMembers={scopeKnown && canRemove}
            renderRoleCell={(member) => (
                <MemberRoleCell
                    member={member}
                    isOwner={Boolean(ownerId) && member.user.id === ownerId}
                    offeredRoles={offeredRoles}
                    canChange={scopeKnown && canChangeRoles}
                    pending={
                        roleMutation.isPending &&
                        roleMutation.variables?.member.user.id === member.user.id
                    }
                    onChange={(next) => {
                        setRoleError(null)
                        if (next !== memberRole(member)) roleMutation.mutate({member, role: next})
                    }}
                />
            )}
            onInvite={() => setInviteOpen(true)}
            onRemove={(member) => {
                setError(null)
                setPendingRemoval(member)
            }}
            onRenameSelf={async (_member, name) => {
                await updateUsername(name)
                await queryClient.invalidateQueries({queryKey: ["profile"]})
                onChanged()
            }}
        >
            {roleError ? (
                <p role="alert" className="m-0 mt-2 text-sm text-colorError">
                    {roleError}
                </p>
            ) : null}

            <Dialog open={inviteOpen} onOpenChange={(next) => (next ? undefined : closeInvite())}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Invite members</DialogTitle>
                        <DialogDescription>
                            They join this organization once they accept.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                        <Input
                            autoFocus
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            onBlur={() => setEmailTouched(true)}
                            aria-invalid={showEmailError || undefined}
                            placeholder="name@company.com"
                        />
                        {showEmailError ? (
                            <p className="m-0 text-sm text-colorError">
                                Enter a valid email address
                            </p>
                        ) : null}
                        {offeredRoles.length ? (
                            <Select value={role} onValueChange={setRole}>
                                {/* Full width, like the field above it — the trigger's
                                    default is fit-to-content, which left it stranded. */}
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {offeredRoles.map((entry) => (
                                        <SelectItem key={entry} value={entry}>
                                            {memberRoleLabel(entry)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : null}
                        {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={closeInvite}
                            disabled={inviteMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            disabled={!emailValid || roleMissing || inviteMutation.isPending}
                            onClick={() => {
                                setError(null)
                                inviteMutation.mutate(email.trim())
                            }}
                        >
                            {inviteMutation.isPending ? "Sending…" : "Send invitation"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <InvitedLinkDialog invited={invitedLink} onClose={() => setInvitedLink(null)} />

            <AlertDialog
                open={Boolean(pendingRemoval)}
                onOpenChange={(next) =>
                    next || removeMutation.isPending ? undefined : setPendingRemoval(null)
                }
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove member</AlertDialogTitle>
                        <AlertDialogDescription>
                            They lose access to this organization.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <p className="m-0 text-sm">
                        Remove {pendingRemoval?.user.username || pendingRemoval?.user.email}?
                    </p>
                    {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={() => setPendingRemoval(null)}
                                disabled={removeMutation.isPending}
                            >
                                Cancel
                            </Button>
                        </AlertDialogCancel>
                        {/* Stays open for the error; the mutation clears pendingRemoval on success. */}
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={removeMutation.isPending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    if (pendingRemoval) removeMutation.mutate(pendingRemoval)
                                }}
                            >
                                {removeMutation.isPending ? "Removing…" : "Remove"}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </MembersPage>
    )
}

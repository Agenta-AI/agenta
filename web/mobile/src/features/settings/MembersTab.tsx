import {useState} from "react"

import {isValidEmailAddress} from "@agenta/auth"
import type {WorkspaceMember} from "@agenta/entities/organization"
import {
    fetchAllWorkspaceRoles,
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

import type {SettingsTabProps} from "./settingsTabProps"
import {useSettingsOrg} from "./useSettingsOrg"

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)

/** Mobile binding for Members: invite and remove as dialogs, your own name renamed in place. */
export const MembersTab = ({workspaceId: routeWorkspaceId}: SettingsTabProps) => {
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
    const queryClient = useQueryClient()

    // NOT a permission check: it only says we know which workspace to write to. Mobile's access
    // model is deliberately optimistic (`useMobileSettingsAccess`) and the API authorizes — there
    // is no packaged RBAC rule yet.
    const scopeKnown = Boolean(organizationId && workspaceId)

    const roles = useQuery({
        queryKey: ["workspace-roles"],
        queryFn: () => fetchAllWorkspaceRoles(true),
        enabled: inviteOpen,
    })

    const emailValid = isValidEmailAddress(email.trim())
    const showEmailError = emailTouched && Boolean(email.trim()) && !emailValid
    // A role is required wherever the API offers roles; still loading counts as offered.
    const roleMissing = (roles.isPending || Boolean(roles.data?.length)) && !role

    const closeInvite = () => {
        setInviteOpen(false)
        setEmail("")
        setRole("")
        setEmailTouched(false)
        setError(null)
    }

    const inviteMutation = useMutation({
        mutationFn: () =>
            inviteToWorkspace({
                organizationId: organizationId!,
                workspaceId: workspaceId!,
                data: [{email: email.trim(), ...(role ? {roles: [role]} : {})}],
            }),
        onSuccess: () => {
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

    if (failed)
        return <LoadError title="Could not load this organization's members" onRetry={retry} />

    return (
        <MembersPage
            members={members}
            loading={loading}
            signedInUser={signedInUser}
            ownerId={ownerId}
            canInviteMembers={scopeKnown}
            canRemoveMembers={scopeKnown}
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
                        {roles.data?.length ? (
                            <Select value={role} onValueChange={setRole}>
                                {/* Full width, like the field above it — the trigger's
                                    default is fit-to-content, which left it stranded. */}
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.data.map((entry) => (
                                        <SelectItem key={entry.role_name} value={entry.role_name}>
                                            {roleLabel(entry.role_name)}
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
                                inviteMutation.mutate()
                            }}
                        >
                            {inviteMutation.isPending ? "Sending…" : "Send invitation"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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

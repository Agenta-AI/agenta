import {useState} from "react"

import type {WorkspaceMember} from "@agenta/entities/organization"
import {
    fetchAllWorkspaceRoles,
    inviteToWorkspace,
    removeFromWorkspace,
} from "@agenta/entities/organization"
import {MembersPage} from "@agenta/settings-ui"
import {useMutation, useQuery} from "@tanstack/react-query"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

interface Props {
    members: WorkspaceMember[]
    loading: boolean
    searchTerm: string
    onSearchChange: (value: string) => void
    signedInUser: {id?: string | null; username?: string | null; email?: string | null} | null
    ownerId?: string | null
    organizationId?: string | null
    workspaceId?: string | null
    onChanged: () => void
}

/**
 * Mobile binding: the shared roster, with invite and remove as bottom sheets. Role editing
 * stays on the desktop — it is a per-row control, and a select inside a table row is a poor
 * trade on a phone.
 */
export const MembersTab = ({
    members,
    loading,
    searchTerm,
    onSearchChange,
    signedInUser,
    ownerId,
    organizationId,
    workspaceId,
    onChanged,
}: Props) => {
    const [inviteOpen, setInviteOpen] = useState(false)
    const [email, setEmail] = useState("")
    const [role, setRole] = useState("")
    const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null)
    const [error, setError] = useState<string | null>(null)

    const canWrite = Boolean(organizationId && workspaceId)

    const roles = useQuery({
        queryKey: ["workspace-roles"],
        queryFn: () => fetchAllWorkspaceRoles(true),
        enabled: inviteOpen,
    })

    const closeInvite = () => {
        setInviteOpen(false)
        setEmail("")
        setRole("")
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

    return (
        <MembersPage
            members={members}
            loading={loading}
            searchTerm={searchTerm}
            onSearchChange={onSearchChange}
            signedInUser={signedInUser}
            ownerId={ownerId}
            canInviteMembers={canWrite}
            canRemoveMembers={canWrite}
            onInvite={() => setInviteOpen(true)}
            onRemove={(member) => {
                setError(null)
                setPendingRemoval(member)
            }}
        >
            <Sheet open={inviteOpen} onOpenChange={(next) => (next ? undefined : closeInvite())}>
                <SheetContent side="bottom">
                    <SheetHeader>
                        <SheetTitle>Invite members</SheetTitle>
                        <SheetDescription>
                            They join this organization once they accept.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="flex flex-col gap-3 px-4">
                        <Input
                            autoFocus
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            placeholder="name@company.com"
                        />
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
                                            {entry.role_name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : null}
                        {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                    </div>
                    <SheetFooter>
                        <Button
                            disabled={!email.trim() || inviteMutation.isPending}
                            onClick={() => {
                                setError(null)
                                inviteMutation.mutate()
                            }}
                        >
                            {inviteMutation.isPending ? "Sending…" : "Send invitation"}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={closeInvite}
                            disabled={inviteMutation.isPending}
                        >
                            Cancel
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            <Sheet
                open={Boolean(pendingRemoval)}
                onOpenChange={(next) => (next ? undefined : setPendingRemoval(null))}
            >
                <SheetContent side="bottom">
                    <SheetHeader>
                        <SheetTitle>Remove member</SheetTitle>
                        <SheetDescription>They lose access to this organization.</SheetDescription>
                    </SheetHeader>
                    <p className="px-4 text-sm">
                        Remove {pendingRemoval?.user.username || pendingRemoval?.user.email}?
                    </p>
                    {error ? <p className="px-4 pt-2 text-sm text-colorError">{error}</p> : null}
                    <SheetFooter>
                        <Button
                            variant="destructive"
                            disabled={removeMutation.isPending}
                            onClick={() => pendingRemoval && removeMutation.mutate(pendingRemoval)}
                        >
                            {removeMutation.isPending ? "Removing…" : "Remove"}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => setPendingRemoval(null)}
                            disabled={removeMutation.isPending}
                        >
                            Cancel
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </MembersPage>
    )
}

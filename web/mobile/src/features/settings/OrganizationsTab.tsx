import {useEffect, useMemo, useState} from "react"

import {
    createOrganization,
    deleteOrganization,
    fetchAllOrgsList,
    transferOrganizationOwnership,
    updateOrganization,
    type Org,
    type WorkspaceMember,
} from "@agenta/entities/organization"
import {useProfile} from "@agenta/entities/profile"
import {OrganizationsPage} from "@agenta/settings-ui"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {groupByOrganization} from "../context/workspaceGroups"

import {ConfirmModal} from "./ConfirmModal"
import {NameDialog} from "./NameDialog"
import type {SettingsTabProps} from "./settingsTabProps"
import {switchSettingsContext} from "./switchContext"
import {useSettingsOrg} from "./useSettingsOrg"

import {fetchProjects} from "@/lib/context"

const errorText = (error: unknown, fallback: string): string => {
    const axiosLike = error as {response?: {data?: {detail?: string}}; message?: string}
    return axiosLike?.response?.data?.detail || axiosLike?.message || fallback
}

/** Mobile binding: create, rename in place, transfer ownership and delete for organizations. */
export const OrganizationsTab = ({workspaceId}: SettingsTabProps) => {
    const router = useRouter()
    const {user} = useProfile()
    const {organizationId: selectedOrgId, org} = useSettingsOrg(workspaceId)
    const orgs = useQuery({queryKey: ["orgs"], queryFn: () => fetchAllOrgsList()})
    const currentUserId = user?.id
    // Ownership can only pass to a member of the current organization.
    const members = org.data?.default_workspace?.members ?? []
    const onChanged = () => {
        void orgs.refetch()
        void org.refetch()
    }
    // Every org's projects, the same list the nav switcher reads, to land on one when switching.
    const allProjects = useQuery({
        queryKey: ["mobile", "projects"],
        queryFn: () => fetchProjects(),
        staleTime: 30_000,
    })
    const groups = useMemo(
        () =>
            allProjects.data?.kind === "ok" ? groupByOrganization(allProjects.data.projects) : [],
        [allProjects.data],
    )
    const [creating, setCreating] = useState(false)
    const [transferring, setTransferring] = useState<Org | null>(null)
    const [deleting, setDeleting] = useState<Org | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const run = async (action: () => Promise<unknown>, fallback: string) => {
        setPending(true)
        setError(null)
        try {
            await action()
            onChanged()
            return true
        } catch (cause) {
            setError(errorText(cause, fallback))
            return false
        } finally {
            setPending(false)
        }
    }

    return (
        <OrganizationsPage
            organizations={orgs.data ?? []}
            loading={orgs.isPending}
            selectedOrgId={selectedOrgId}
            currentUserId={currentUserId}
            onSwitch={(org) => {
                const group = groups.find((entry) => entry.organizationId === org.id)
                const first = group?.projects[0]
                if (!group || !first) return
                switchSettingsContext(router, {
                    workspaceId: group.workspaceId,
                    projectId: first.project_id,
                    tab: "organizationGeneral",
                })
            }}
            onCreate={() => {
                setError(null)
                setCreating(true)
            }}
            onRename={async (org, name) => {
                try {
                    await updateOrganization(org.id, {name})
                } catch (cause) {
                    throw new Error(errorText(cause, "Couldn't rename this organization"))
                }
                onChanged()
            }}
            onTransferOwnership={(org) => {
                setError(null)
                setTransferring(org)
            }}
            onDelete={(org) => {
                setError(null)
                setDeleting(org)
            }}
        >
            <NameDialog
                open={creating}
                title="New organization"
                description="An organization groups your workspaces, projects and the people in them."
                placeholder="Organization name"
                submitLabel="Create"
                pending={pending}
                error={error}
                onClose={() => setCreating(false)}
                onSubmit={async (name) => {
                    if (await run(() => createOrganization({name}), "Couldn't create it"))
                        setCreating(false)
                }}
            />

            <TransferDialog
                org={transferring}
                members={members}
                currentUserId={currentUserId}
                pending={pending}
                error={error}
                onClose={() => setTransferring(null)}
                onTransfer={async (userId) => {
                    if (!transferring) return
                    const org = transferring
                    const done = await run(
                        () => transferOrganizationOwnership(org.id, userId),
                        "Couldn't transfer ownership",
                    )
                    if (done) setTransferring(null)
                }}
            />

            <ConfirmModal
                open={Boolean(deleting)}
                title="Delete organization"
                description="This cannot be undone."
                body={`Permanently deletes ${deleting?.name ?? "this organization"}, with every workspace, project and agent in it.`}
                confirmLabel="Delete organization"
                pending={pending}
                error={error ?? undefined}
                onClose={() => setDeleting(null)}
                onConfirm={async () => {
                    if (!deleting) return
                    const org = deleting
                    const done = await run(
                        () => deleteOrganization(org.id),
                        "Couldn't delete this organization",
                    )
                    if (!done) return
                    setDeleting(null)
                    // The app is scoped to the organization that just went away.
                    if (org.id === selectedOrgId) void router.replace("/")
                }}
            />
        </OrganizationsPage>
    )
}

const TransferDialog = ({
    org,
    members,
    currentUserId,
    pending,
    error,
    onClose,
    onTransfer,
}: {
    org: Org | null
    members: WorkspaceMember[]
    currentUserId?: string | null
    pending: boolean
    error: string | null
    onClose: () => void
    onTransfer: (userId: string) => void
}) => {
    const [userId, setUserId] = useState("")
    // Each opening starts with no member chosen.
    useEffect(() => setUserId(""), [org])
    const candidates = useMemo(
        () => members.filter((member) => member.user?.id && member.user.id !== currentUserId),
        [members, currentUserId],
    )

    return (
        <Dialog
            open={Boolean(org)}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Transfer ownership</DialogTitle>
                    <DialogDescription>
                        The new owner gets full control of {org?.name ?? "this organization"}. You
                        stay a member.
                    </DialogDescription>
                </DialogHeader>
                {candidates.length ? (
                    <Select value={userId} onValueChange={setUserId}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose a member" />
                        </SelectTrigger>
                        <SelectContent>
                            {candidates.map((member) => (
                                <SelectItem key={member.user.id} value={member.user.id}>
                                    {member.user.username || member.user.email}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <p className="m-0 text-sm text-muted-foreground">
                        Invite someone to this organization first; ownership can only pass to a
                        member.
                    </p>
                )}
                {error ? (
                    <p role="alert" className="text-destructive m-0 text-xs">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button disabled={!userId || pending} onClick={() => onTransfer(userId)}>
                        Transfer
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

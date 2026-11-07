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
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsOrganizationsTabCatalog from "@agenta/i18n/catalogs/settings.organizationsTab"
import {OrganizationsPage} from "@agenta/settings-ui"
import {message} from "@agenta/ui/app-message"
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
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {useRouter} from "next/router"

import {fetchProjects} from "@/lib/context"

import {groupByOrganization} from "../context/workspaceGroups"

import {ConfirmModal} from "./ConfirmModal"
import {NameDialog} from "./NameDialog"
import type {SettingsTabProps} from "./settingsTabProps"
import {switchSettingsContext} from "./switchContext"
import {useSettingsOrg} from "./useSettingsOrg"

const errorText = (error: unknown, fallback: string): string => {
    const axiosLike = error as {response?: {data?: {detail?: string}}; message?: string}
    return axiosLike?.response?.data?.detail || axiosLike?.message || fallback
}

/** Mobile binding: create, rename in place, transfer ownership and delete for organizations. */
export const OrganizationsTab = ({workspaceId}: SettingsTabProps) => {
    const t = useT(commonCatalog, settingsOrganizationsTabCatalog)
    const router = useRouter()
    const queryClient = useQueryClient()
    const {user} = useProfile()
    const {organizationId: selectedOrgId, org} = useSettingsOrg(workspaceId)
    const orgs = useQuery({queryKey: ["orgs"], queryFn: () => fetchAllOrgsList()})
    const currentUserId = user?.id
    // Ownership can only pass to a member of the current organization.
    const members = org.data?.default_workspace?.members ?? []
    const onChanged = () => {
        void orgs.refetch()
        void org.refetch()
        // The nav switcher and org switching read org names and projects from this list.
        void queryClient.invalidateQueries({queryKey: ["mobile", "projects"]})
    }
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
            onSwitch={async (org) => {
                // The nav switcher's list, fetched if it is not cached yet.
                const result = await queryClient.fetchQuery({
                    queryKey: ["mobile", "projects"],
                    queryFn: () => fetchProjects(),
                    staleTime: 30_000,
                })
                const groups = result.kind === "ok" ? groupByOrganization(result.projects) : []
                const group = groups.find((entry) => entry.organizationId === org.id)
                const first = group?.projects[0]
                if (!group || !first) {
                    message.info(
                        t("settings.organizationsTab.noProjectYet", {
                            name:
                                org.name ?? t("settings.organizationsTab.thisOrganizationCapital"),
                        }),
                    )
                    return
                }
                switchSettingsContext(router, {
                    workspaceId: group.workspaceId,
                    projectId: first.project_id,
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
                    throw new Error(errorText(cause, t("settings.organizationsTab.renameFailed")))
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
                title={t("settings.organizationsTab.newTitle")}
                description={t("settings.organizationsTab.newDescription")}
                placeholder={t("settings.organizationsTab.namePlaceholder")}
                submitLabel={t("common.create")}
                pending={pending}
                error={error}
                onClose={() => setCreating(false)}
                onSubmit={async (name) => {
                    if (
                        await run(
                            () => createOrganization({name}),
                            t("settings.organizationsTab.createFailed"),
                        )
                    )
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
                        t("settings.organizationsTab.transferFailed"),
                    )
                    if (done) setTransferring(null)
                }}
            />

            <ConfirmModal
                open={Boolean(deleting)}
                title={t("settings.organizationsTab.deleteTitle")}
                description={t("common.thisCannotBeUndone")}
                body={t("settings.organizationsTab.deleteBody", {
                    name: deleting?.name ?? t("settings.organizationsTab.thisOrganization"),
                })}
                confirmLabel={t("settings.organizationsTab.deleteTitle")}
                pending={pending}
                error={error ?? undefined}
                onClose={() => setDeleting(null)}
                onConfirm={async () => {
                    if (!deleting) return
                    const org = deleting
                    const done = await run(
                        () => deleteOrganization(org.id),
                        t("settings.organizationsTab.deleteFailed"),
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
    const t = useT(commonCatalog, settingsOrganizationsTabCatalog)
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
                    <DialogTitle>{t("settings.organizationsTab.transferTitle")}</DialogTitle>
                    <DialogDescription>
                        {t("settings.organizationsTab.transferDescription", {
                            name: org?.name ?? t("settings.organizationsTab.thisOrganization"),
                        })}
                    </DialogDescription>
                </DialogHeader>
                {candidates.length ? (
                    <Select value={userId} onValueChange={setUserId}>
                        <SelectTrigger className="w-full">
                            <SelectValue
                                placeholder={t("settings.organizationsTab.chooseMember")}
                            />
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
                        {t("settings.organizationsTab.inviteFirst")}
                    </p>
                )}
                {error ? (
                    <p role="alert" className="text-destructive m-0 text-xs">
                        {error}
                    </p>
                ) : null}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={!userId || pending} onClick={() => onTransfer(userId)}>
                        {t("settings.organizationsTab.transfer")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

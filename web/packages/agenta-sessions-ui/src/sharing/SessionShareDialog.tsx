import {useEffect, useMemo, useState} from "react"

import type {
    DisclosedConnection,
    ProjectMemberProfile,
    SessionRole,
    SessionSharingState,
    ShareDisclosure,
    Visibility,
} from "@agenta/entities/sharing"
import {
    Alert,
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    LoadingButton,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {LinkIcon, LockSimpleIcon, UsersIcon} from "@phosphor-icons/react"

import {joinNames, sessionRoleCopy, sessionSharingCopy as copy} from "./copy"
import {MemberPicker} from "./MemberPicker"
import {PersonAvatar, personName, type SharingPerson} from "./people"
import type {SharingWriteResult} from "./result"
import {ROLE_COLUMN_CLASS, SessionGrantRoleMenu} from "./SessionGrantRoleMenu"
import {ShareDisclosureNotice, type ShareDisclosureTarget} from "./ShareDisclosureNotice"
import {SharingSurface} from "./SharingSurface"

export interface SessionShareDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    sessionName: string
    projectName: string
    sharing: SessionSharingState | null | undefined
    disclosure: ShareDisclosure | null | undefined
    loading?: boolean
    loadError?: boolean
    onRetry?: () => void
    /** Profiles of the owner and the grantees; a grant without one shows its user id. */
    people: readonly SharingPerson[]
    members: readonly ProjectMemberProfile[]
    membersSearch: string
    onMembersSearch: (text: string) => void
    membersLoading?: boolean
    membersError?: boolean
    providerLabel?: (connection: DisclosedConnection) => string
    onUpsertGrant: (userId: string, role: SessionRole) => Promise<SharingWriteResult>
    onRevokeGrant: (userId: string) => Promise<SharingWriteResult>
    onSetVisibility: (visibility: Visibility) => Promise<SharingWriteResult>
    /** The only-me route: private, every grant removed. */
    onOnlyMe: () => Promise<SharingWriteResult>
    /** Copies the link; answer `false` when the copy failed (the host says so, not the toast). */
    onCopyLink?: () => void | boolean | Promise<void | boolean>
    /** Shows a toast. */
    onNotify?: (message: string) => void
    /** Refetches the sharing state after a 409. */
    onReload?: () => void
    /**
     * The agent has items that use each person's own account, so the chat may show what it did
     * with the owner's accounts: one line says so.
     */
    usesPersonalAccounts?: boolean
}

/** A widening change waiting for the disclosure. */
type Widening = {kind: "invite"} | {kind: "raise"; userId: string} | {kind: "project"}

export const SessionShareDialog = ({
    open,
    onOpenChange,
    sessionName,
    projectName,
    sharing,
    disclosure,
    loading = false,
    loadError = false,
    onRetry,
    people,
    members,
    membersSearch,
    onMembersSearch,
    membersLoading,
    membersError,
    providerLabel,
    onUpsertGrant,
    onRevokeGrant,
    onSetVisibility,
    onOnlyMe,
    onCopyLink,
    onNotify,
    onReload,
    usesPersonalAccounts = false,
}: SessionShareDialogProps) => {
    const [picked, setPicked] = useState<SharingPerson[]>([])
    const [inviteRole, setInviteRole] = useState<SessionRole>("viewer")
    const [invalidIds, setInvalidIds] = useState<string[]>([])
    const [notice, setNotice] = useState<"conflict" | "failed" | null>(null)
    const [saving, setSaving] = useState<string | null>(null)
    const [widening, setWidening] = useState<Widening | null>(null)
    const [stopOpen, setStopOpen] = useState(false)

    const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people])
    const nameOf = (userId: string) => personName(byId.get(userId)) || userId

    const isOwner = sharing?.my_role === "owner"
    const ready = Boolean(sharing) && !loading && !loadError
    // Confirmations close when the state is unknown or no longer the owner's.
    const writable = open && ready && isOwner
    // A confirmation left pending when the dialog closes does not come back on its own later.
    useEffect(() => {
        if (open) return
        setWidening(null)
        setStopOpen(false)
    }, [open])
    const ownerId = sharing?.policy.owner_user_id ?? null
    const grants = sharing?.grants ?? []
    const visibility = sharing?.policy.visibility ?? "private"
    const nobodyAdded = visibility === "private" && grants.length === 0

    /** True when the write landed; otherwise shows its notice. */
    const settle = (result: SharingWriteResult): boolean => {
        if (result === "ok") {
            setNotice(null)
            return true
        }
        if (result === "conflict") {
            setNotice("conflict")
            onReload?.()
        } else {
            setNotice("failed")
        }
        return false
    }

    const run = async (key: string, write: () => Promise<SharingWriteResult>) => {
        setSaving(key)
        try {
            return settle(await write())
        } catch {
            return settle("failed")
        } finally {
            setSaving(null)
        }
    }

    const invite = async () => {
        setSaving("invite")
        const kept: SharingPerson[] = []
        const invalid: string[] = []
        let failure: SharingWriteResult | null = null
        for (const person of picked) {
            if (failure) {
                kept.push(person)
                continue
            }
            let result: SharingWriteResult
            try {
                result = await onUpsertGrant(person.user_id, inviteRole)
            } catch {
                result = "failed"
            }
            if (result === "ok") continue
            kept.push(person)
            if (result === "invalid_grantee") invalid.push(person.user_id)
            else failure = result
        }
        setSaving(null)
        setPicked(kept)
        setInvalidIds(invalid)
        if (failure) settle(failure)
        else setNotice(null)
    }

    const confirmWidening = async () => {
        if (!widening || !writable) return
        if (widening.kind === "invite") await invite()
        else if (widening.kind === "raise") {
            const {userId} = widening
            await run(userId, () => onUpsertGrant(userId, "participant"))
        } else await run("visibility", () => onSetVisibility("project"))
        setWidening(null)
    }

    const disclosureTarget: ShareDisclosureTarget =
        widening?.kind === "project"
            ? {kind: "session-project", projectName}
            : {
                  kind: "session-people",
                  names:
                      widening?.kind === "raise"
                          ? [nameOf(widening.userId)]
                          : picked.map((p) => personName(p)),
              }

    const changeVisibility = (next: Visibility) => {
        if (next === visibility) return
        if (next === "project") setWidening({kind: "project"})
        else void run("visibility", () => onSetVisibility("private"))
    }

    const stopSharing = async () => {
        if (!writable) return
        await run("stop", onOnlyMe)
        setStopOpen(false)
    }

    const copyLink = async () => {
        if ((await onCopyLink?.()) === false) return
        onNotify?.(copy.linkCopied)
    }

    const owner = ownerId ? byId.get(ownerId) : undefined

    const footer = ready ? (
        <>
            {isOwner && !nobodyAdded ? (
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-error sm:mr-auto"
                    onClick={() => setStopOpen(true)}
                >
                    {copy.stopSharing}
                </Button>
            ) : null}
            {onCopyLink ? (
                <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
                    <LinkIcon size={13} aria-hidden />
                    {copy.copyLink}
                </Button>
            ) : null}
            <Button onClick={() => onOpenChange(false)}>{copy.done}</Button>
        </>
    ) : undefined

    return (
        <>
            <SharingSurface
                open={open}
                onOpenChange={onOpenChange}
                title={copy.dialogTitle}
                description={sessionName}
                footer={footer}
            >
                {loadError ? (
                    <Alert
                        type="error"
                        showIcon
                        message={copy.loadError}
                        action={
                            onRetry ? (
                                <Button size="sm" onClick={onRetry}>
                                    {copy.retry}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : !ready || !sharing ? (
                    <div className="flex flex-col gap-3" aria-busy>
                        <SkeletonBlock className="h-9 w-full" />
                        <SkeletonBlock className="h-7 w-1/2" />
                        <SkeletonBlock className="h-7 w-2/5" />
                        <SkeletonBlock className="h-4 w-3/4" />
                    </div>
                ) : (
                    <>
                        {notice === "conflict" ? (
                            <Alert type="warning" showIcon role="status" message={copy.conflict} />
                        ) : null}

                        {usesPersonalAccounts && isOwner ? (
                            <p className="m-0 text-xs text-muted-foreground">
                                {copy.personalAccountsNote}
                            </p>
                        ) : null}

                        {isOwner ? (
                            <div className="flex flex-col gap-2">
                                <div className="flex items-start gap-2">
                                    <MemberPicker
                                        projectName={projectName}
                                        members={members}
                                        search={membersSearch}
                                        onSearch={onMembersSearch}
                                        selected={picked}
                                        onPick={(member) => {
                                            setPicked((list) => [...list, member])
                                        }}
                                        onRemove={(userId) => {
                                            setPicked((list) =>
                                                list.filter((p) => p.user_id !== userId),
                                            )
                                            setInvalidIds((ids) =>
                                                ids.filter((id) => id !== userId),
                                            )
                                        }}
                                        excludeUserIds={ownerId ? [ownerId] : []}
                                        accessUserIds={grants.map((g) => g.user_id)}
                                        invalidUserIds={invalidIds}
                                        loading={membersLoading}
                                        error={membersError}
                                        disabled={saving === "invite"}
                                    />
                                    <Select
                                        value={inviteRole}
                                        onValueChange={(value) =>
                                            setInviteRole(value as SessionRole)
                                        }
                                    >
                                        <SelectTrigger className="w-auto shrink-0">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="viewer">
                                                {sessionRoleCopy.viewer.label}
                                            </SelectItem>
                                            <SelectItem value="participant">
                                                {sessionRoleCopy.participant.label}
                                            </SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <LoadingButton
                                        loading={saving === "invite"}
                                        disabled={picked.length === 0}
                                        onClick={() => setWidening({kind: "invite"})}
                                    >
                                        {copy.inviteButton}
                                    </LoadingButton>
                                </div>
                                {inviteRole === "participant" &&
                                picked.some((p) => p.can_run_sessions === false) ? (
                                    <span className="text-xs text-muted-foreground">
                                        {copy.inviteViewOnly(
                                            joinNames(
                                                picked
                                                    .filter((p) => p.can_run_sessions === false)
                                                    .map((p) => personName(p)),
                                            ),
                                        )}
                                    </span>
                                ) : null}
                                {invalidIds.map((userId) => (
                                    <p key={userId} className="m-0 text-xs text-error">
                                        {copy.invalidGrantee(nameOf(userId))}
                                    </p>
                                ))}
                            </div>
                        ) : null}

                        <section className="flex flex-col gap-1">
                            <span className="text-xs font-medium text-muted-foreground">
                                {copy.peopleSection}
                            </span>
                            {owner || ownerId ? (
                                <div className="flex items-center gap-2 py-1.5">
                                    <PersonAvatar
                                        person={owner ?? {user_id: ownerId ?? "", email: ""}}
                                    />
                                    <div className="flex min-w-0 flex-1 flex-col">
                                        <span className="truncate text-sm font-medium">
                                            {owner ? personName(owner) : ownerId}{" "}
                                            {isOwner ? (
                                                <span className="font-normal text-muted-foreground">
                                                    {copy.ownerSuffix}
                                                </span>
                                            ) : null}
                                        </span>
                                        {owner?.name ? (
                                            <span className="truncate text-xs text-muted-foreground">
                                                {owner.email}
                                            </span>
                                        ) : null}
                                    </div>
                                    <span className={`${ROLE_COLUMN_CLASS} px-1.5 text-sm`}>
                                        {copy.ownerRole}
                                    </span>
                                </div>
                            ) : null}
                            {grants.length === 0 ? (
                                <p className="m-0 py-1 pl-9 text-xs text-muted-foreground">
                                    {copy.emptyGrants}
                                </p>
                            ) : (
                                grants.map((grant) => {
                                    const person = byId.get(grant.user_id) ?? {
                                        user_id: grant.user_id,
                                        email: "",
                                    }
                                    return (
                                        <div
                                            key={grant.user_id}
                                            data-testid="session-grant-row"
                                            className="flex items-center gap-2 py-1.5"
                                        >
                                            <PersonAvatar person={person} />
                                            <div className="flex min-w-0 flex-1 flex-col">
                                                <span className="truncate text-sm font-medium">
                                                    {nameOf(grant.user_id)}
                                                </span>
                                                {person.name ? (
                                                    <span className="truncate text-xs text-muted-foreground">
                                                        {person.email}
                                                    </span>
                                                ) : null}
                                                {grant.role === "participant" &&
                                                person.can_run_sessions === false ? (
                                                    <span className="text-xs text-muted-foreground">
                                                        {copy.grantViewOnlyByRole}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <span className={ROLE_COLUMN_CLASS}>
                                                {isOwner ? (
                                                    <SessionGrantRoleMenu
                                                        role={grant.role}
                                                        canSend={person.can_run_sessions !== false}
                                                        personName={nameOf(grant.user_id)}
                                                        saving={saving === grant.user_id}
                                                        onChangeRole={(role) => {
                                                            if (role === "participant") {
                                                                setWidening({
                                                                    kind: "raise",
                                                                    userId: grant.user_id,
                                                                })
                                                            } else {
                                                                void run(grant.user_id, () =>
                                                                    onUpsertGrant(
                                                                        grant.user_id,
                                                                        role,
                                                                    ),
                                                                )
                                                            }
                                                        }}
                                                        onRemove={() =>
                                                            void run(grant.user_id, () =>
                                                                onRevokeGrant(grant.user_id),
                                                            )
                                                        }
                                                    />
                                                ) : (
                                                    <span className="px-1.5 text-sm">
                                                        {
                                                            sessionRoleCopy[
                                                                person.can_run_sessions === false
                                                                    ? "viewer"
                                                                    : grant.role
                                                            ].label
                                                        }
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                    )
                                })
                            )}
                        </section>

                        <section className="flex flex-col gap-2">
                            <span className="text-xs font-medium text-muted-foreground">
                                {copy.generalSection}
                            </span>
                            <div className="flex items-center gap-2.5">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                                    {visibility === "private" ? (
                                        <LockSimpleIcon size={14} aria-hidden />
                                    ) : (
                                        <UsersIcon size={14} aria-hidden />
                                    )}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col items-start">
                                    {isOwner ? (
                                        <Select
                                            value={visibility}
                                            disabled={saving === "visibility"}
                                            onValueChange={(value) =>
                                                changeVisibility(value as Visibility)
                                            }
                                        >
                                            <SelectTrigger
                                                variant="ghost"
                                                className="-ml-2 w-auto font-medium"
                                                aria-label={copy.generalSection}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="private">
                                                    {copy.generalPrivate}
                                                </SelectItem>
                                                <SelectItem value="project">
                                                    {copy.generalProject}
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <span className="text-sm font-medium">
                                            {visibility === "private"
                                                ? copy.generalPrivate
                                                : copy.generalProject}
                                        </span>
                                    )}
                                    <p className="m-0 text-xs text-muted-foreground">
                                        {visibility === "private"
                                            ? copy.generalPrivateDescription
                                            : copy.generalProjectDescription(projectName)}
                                    </p>
                                </div>
                            </div>
                        </section>

                        {notice === "failed" ? (
                            <Alert type="error" showIcon message={copy.saveFailed} />
                        ) : null}
                    </>
                )}
            </SharingSurface>

            <ShareDisclosureNotice
                open={writable && widening !== null}
                onOpenChange={(next) => {
                    if (!next && !saving) setWidening(null)
                }}
                target={disclosureTarget}
                disclosure={disclosure}
                providerLabel={providerLabel}
                onConfirm={() => void confirmWidening()}
                confirming={saving !== null}
            />

            <AlertDialog
                open={writable && stopOpen}
                onOpenChange={(next) => !saving && setStopOpen(next)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{copy.stopTitle}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {visibility === "project"
                                ? copy.stopBodyProject(projectName)
                                : copy.stopBodyPeople(grants.map((g) => nameOf(g.user_id)))}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving === "stop"}>
                            {copy.cancel}
                        </AlertDialogCancel>
                        <LoadingButton
                            variant="destructive"
                            loading={saving === "stop"}
                            onClick={() => void stopSharing()}
                        >
                            {copy.stopSharing}
                        </LoadingButton>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

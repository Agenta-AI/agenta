import {useState, type ReactNode} from "react"

import type {
    AgentSharingState,
    DisclosedConnection,
    ProjectMemberProfile,
    ShareDisclosure,
    Visibility,
} from "@agenta/entities/sharing"
import {
    PersonAvatar,
    ShareDisclosureNotice,
    SharingSurface,
    personName,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
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
    RadioGroup,
    RadioGroupItem,
    SkeletonBlock,
    cn,
} from "@agenta/ui/ui"
import {UsersIcon} from "@phosphor-icons/react"

import {AgentTransferDialog} from "./AgentTransferDialog"
import {agentSharingCopy as copy} from "./copy"
import {
    useAgentSharingWrites,
    type AgentChannelConnection,
    type AgentSharingNotice,
} from "./useAgentSharingWrites"

export interface AgentPrivacyProps {
    agentName: string
    projectName: string
    sharing: AgentSharingState | null | undefined
    disclosure: ShareDisclosure | null | undefined
    loading?: boolean
    loadError?: boolean
    onRetry?: () => void
    /** The owner's profile (the current user when `my_role` is "owner"). */
    owner?: SharingPerson | null
    /** The channel apps bound to this agent: drive the make-private warning. */
    channelConnections?: readonly AgentChannelConnection[]
    /** Platforms whose connection is still off after the agent was shared again. */
    channelsOff?: readonly string[]
    onOpenChannels?: () => void
    members: readonly ProjectMemberProfile[]
    membersSearch: string
    onMembersSearch: (text: string) => void
    membersLoading?: boolean
    membersError?: boolean
    providerLabel?: (connection: DisclosedConnection) => string
    onSetVisibility: (visibility: Visibility) => Promise<SharingWriteResult>
    onTransfer: (userId: string) => Promise<SharingWriteResult>
    onTakeOwnership: () => Promise<SharingWriteResult>
    /** Shows a toast. */
    onNotify?: (message: string) => void
    /** Refetches the sharing state after a 409. */
    onReload?: () => void
}

export type AgentSharingWrites = ReturnType<typeof useAgentSharingWrites>

export interface AgentPrivacyDialogProps extends AgentPrivacyProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Shared with the top bar panel; the dialog makes its own when absent. */
    writes?: AgentSharingWrites
}

const Note = ({notice, owner}: {notice: AgentSharingNotice; owner: string}) => {
    if (notice === "conflict") {
        return <Alert type="warning" showIcon role="status" message={copy.conflict} />
    }
    if (notice === "owner_active") {
        return <Alert type="warning" showIcon message={copy.ownerActive(owner)} />
    }
    if (notice === "failed") return <Alert type="error" showIcon message={copy.saveFailed} />
    return null
}

const VisibilityCard = ({
    value,
    title,
    description,
    checked,
}: {
    value: Visibility
    title: string
    description: string
    checked: boolean
}) => (
    <label
        className={cn(
            "box-border flex cursor-pointer gap-2.5 rounded-control-lg border border-solid border-border p-3",
            checked && "border-foreground ring-1 ring-foreground",
        )}
    >
        <RadioGroupItem value={value} className="mt-0.5" />
        <span className="flex flex-col">
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs text-muted-foreground">{description}</span>
        </span>
    </label>
)

const OwnerRow = ({
    owner,
    you,
    action,
}: {
    owner: SharingPerson
    you: boolean
    action?: ReactNode
}) => (
    <div className="flex items-center gap-2 py-1">
        <PersonAvatar person={owner} />
        <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
                {personName(owner)}{" "}
                {you ? (
                    <span className="font-normal text-muted-foreground">{copy.youSuffix}</span>
                ) : null}
            </span>
            <span className="truncate text-xs text-muted-foreground">
                {you ? owner.email : copy.ownerRole}
            </span>
        </div>
        {action}
    </div>
)

export const AgentPrivacyDialog = ({
    open,
    onOpenChange,
    writes: sharedWrites,
    ...props
}: AgentPrivacyDialogProps) => {
    const {
        agentName,
        projectName,
        sharing,
        disclosure,
        loading = false,
        loadError = false,
        onRetry,
        owner,
        channelConnections = [],
        channelsOff = [],
        onOpenChannels,
        providerLabel,
    } = props
    const ownWrites = useAgentSharingWrites(props)
    const writes = sharedWrites ?? ownWrites
    const [confirm, setConfirm] = useState<Visibility | null>(null)
    const [transferOpen, setTransferOpen] = useState(false)

    const isOwner = sharing?.my_role === "owner"
    const ownerId = sharing?.policy.owner_user_id ?? null
    const visibility = sharing?.policy.visibility ?? "project"
    const ownerName = personName(owner) || ownerId || ""
    const ready = Boolean(sharing) && !loading && !loadError

    const confirmVisibility = async () => {
        if (!confirm) return
        await writes.setVisibility(confirm)
        setConfirm(null)
    }

    const takeOwnershipRow = sharing?.can_take_ownership ? (
        <div className="flex flex-wrap items-center gap-2.5">
            <LoadingButton
                loading={writes.saving === "take"}
                onClick={() => void writes.takeOwnership()}
            >
                {copy.takeOwnership}
            </LoadingButton>
            <span className="text-xs text-muted-foreground">{copy.takeOwnershipHelp}</span>
        </div>
    ) : null

    let body: ReactNode
    if (loadError) {
        body = (
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
        )
    } else if (!ready || !sharing) {
        body = (
            <div className="flex flex-col gap-2" aria-busy>
                <SkeletonBlock className="h-[54px] w-full" />
                <SkeletonBlock className="h-[54px] w-full" />
            </div>
        )
    } else if (!ownerId) {
        body = (
            <>
                <Alert type="info" showIcon message={copy.noOwner} />
                {takeOwnershipRow}
            </>
        )
    } else if (!sharing.owner_is_active) {
        body = (
            <>
                <Alert
                    type="info"
                    showIcon
                    message={
                        sharing.can_take_ownership
                            ? copy.ownerLeft(ownerName)
                            : `${copy.ownerLeft(ownerName)} ${copy.ownerLeftNonAdmin}`
                    }
                />
                {takeOwnershipRow}
            </>
        )
    } else if (!isOwner) {
        body = (
            <>
                <div className="box-border flex items-center gap-2.5 rounded-control-lg border border-solid border-border p-3">
                    <UsersIcon size={15} aria-hidden />
                    <span className="text-sm font-semibold">{copy.cardProject}</span>
                </div>
                {owner ? <OwnerRow owner={owner} you={false} /> : null}
                <p className="m-0 text-xs text-muted-foreground">{copy.notOwner(ownerName)}</p>
            </>
        )
    } else {
        body = (
            <>
                <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className="mb-2 p-0 text-xs font-medium text-muted-foreground">
                        {copy.whoSection}
                    </legend>
                    <RadioGroup
                        value={visibility}
                        disabled={writes.saving === "visibility"}
                        onValueChange={(next) => {
                            if (next !== visibility) setConfirm(next as Visibility)
                        }}
                    >
                        <VisibilityCard
                            value="private"
                            title={copy.cardPrivate}
                            description={copy.linePrivate}
                            checked={visibility === "private"}
                        />
                        <VisibilityCard
                            value="project"
                            title={copy.cardProject}
                            description={copy.lineProject(projectName)}
                            checked={visibility === "project"}
                        />
                    </RadioGroup>
                </fieldset>
                <section className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                        {copy.ownerSection}
                    </span>
                    {owner ? (
                        <OwnerRow
                            owner={owner}
                            you
                            action={
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setTransferOpen(true)}
                                >
                                    {copy.transferButton}
                                </Button>
                            }
                        />
                    ) : null}
                </section>
            </>
        )
    }

    return (
        <>
            <SharingSurface
                open={open}
                onOpenChange={onOpenChange}
                title={copy.dialogTitle}
                description={agentName}
                footer={<Button onClick={() => onOpenChange(false)}>{copy.done}</Button>}
            >
                <Note notice={writes.notice} owner={ownerName} />
                {body}
                {ready && channelsOff.length > 0 && visibility === "project" ? (
                    <Alert
                        type="info"
                        showIcon
                        role="status"
                        message={copy.channelsOff(channelsOff)}
                        action={
                            onOpenChannels ? (
                                <Button size="sm" variant="link" onClick={onOpenChannels}>
                                    {copy.openChannels}
                                </Button>
                            ) : undefined
                        }
                    />
                ) : null}
            </SharingSurface>

            <AlertDialog
                open={confirm === "private"}
                onOpenChange={(next) => !next && !writes.saving && setConfirm(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{copy.makePrivateTitle(agentName)}</AlertDialogTitle>
                        <AlertDialogDescription>{copy.makePrivateBody}</AlertDialogDescription>
                    </AlertDialogHeader>
                    {channelConnections.length > 0 ? (
                        <Alert
                            type="warning"
                            showIcon
                            role="note"
                            message={
                                channelConnections.length === 1
                                    ? copy.channelOne(
                                          channelConnections[0].platform,
                                          channelConnections[0].workspace,
                                      )
                                    : copy.channelMany([
                                          ...new Set(channelConnections.map((c) => c.platform)),
                                      ])
                            }
                            description={copy.channelRestore}
                        />
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={writes.saving === "visibility"}>
                            {copy.cancel}
                        </AlertDialogCancel>
                        <LoadingButton
                            loading={writes.saving === "visibility"}
                            onClick={() => void confirmVisibility()}
                        >
                            {copy.makePrivate}
                        </LoadingButton>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <ShareDisclosureNotice
                open={confirm === "project"}
                onOpenChange={(next) => !next && !writes.saving && setConfirm(null)}
                target={{kind: "agent", agentName, projectName}}
                disclosure={disclosure}
                providerLabel={providerLabel}
                onConfirm={() => void confirmVisibility()}
                confirming={writes.saving === "visibility"}
            />

            <AgentTransferDialog
                open={transferOpen}
                onOpenChange={setTransferOpen}
                agentName={agentName}
                projectName={projectName}
                isPrivate={visibility === "private"}
                ownerUserId={ownerId}
                members={props.members}
                membersSearch={props.membersSearch}
                onMembersSearch={props.onMembersSearch}
                membersLoading={props.membersLoading}
                membersError={props.membersError}
                onTransfer={props.onTransfer}
                onTransferred={writes.transferred}
                onFailed={(result) => writes.settle(result)}
            />
        </>
    )
}

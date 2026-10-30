import {useState} from "react"

import type {
    SessionGrant,
    SessionRole,
    SessionSharingState,
    ShareDisclosure,
    Visibility,
} from "@agenta/entities/sharing"
import {
    SessionAccessChip,
    SessionShareButton,
    SessionShareDialog,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
import type {Meta, StoryObj} from "@storybook/nextjs"

const alice = {user_id: "u-alice", email: "alice@acme.com", name: "Alice Martin"}
const bob = {user_id: "u-bob", email: "bob@acme.com", name: "Bob Lee"}
const carol = {user_id: "u-carol", email: "carol@acme.com", name: "Carol Ng"}
const PEOPLE = [alice, bob, carol]
const DISCLOSURE: ShareDisclosure = {
    connections: [
        {provider: "composio", integration: "gmail", connection: "c1"},
        {provider: "composio", integration: "shopify", connection: "c2"},
    ],
    turns_use_run_credentials: true,
    files_and_tool_results_shared: true,
    trace_readers_can_read: true,
}

const state = (over: Partial<SessionSharingState> = {}): SessionSharingState => ({
    policy: {visibility: "private", owner_user_id: alice.user_id},
    owner_is_active: true,
    grants: [],
    my_role: "owner",
    can_send: true,
    shareable: true,
    ...over,
})
const grant = (userId: string, role: SessionRole): SessionGrant => ({
    stream_id: "s-1",
    user_id: userId,
    role,
})

interface DialogStoryProps {
    initial: SessionSharingState | null
    loading?: boolean
    loadError?: boolean
    /** What every write answers. */
    result?: SharingWriteResult
    /** Users the invite refuses with 422. */
    invalidUserIds?: string[]
    /** The agent has items that use each person's own account. */
    usesPersonalAccounts?: boolean
}

function ShareDialogStory({
    initial,
    loading,
    loadError,
    result = "ok",
    invalidUserIds = [],
    usesPersonalAccounts = false,
}: DialogStoryProps) {
    const [sharing, setSharing] = useState(initial)
    const [open, setOpen] = useState(true)
    const [search, setSearch] = useState("")
    const [toast, setToast] = useState<string | null>(null)

    const upsert = async (userId: string, role: SessionRole) => {
        if (invalidUserIds.includes(userId)) return "invalid_grantee" as const
        if (result !== "ok" || !sharing) return result
        const others = sharing.grants.filter((g) => g.user_id !== userId)
        setSharing({...sharing, grants: [...others, grant(userId, role)]})
        return "ok" as const
    }
    const revoke = async (userId: string) => {
        if (result !== "ok" || !sharing) return result
        setSharing({...sharing, grants: sharing.grants.filter((g) => g.user_id !== userId)})
        return "ok" as const
    }
    const setVisibility = async (visibility: Visibility) => {
        if (result !== "ok" || !sharing) return result
        setSharing({...sharing, policy: {...sharing.policy, visibility}})
        return "ok" as const
    }
    const onlyMe = async () => {
        if (result !== "ok" || !sharing) return result
        setSharing({...sharing, grants: [], policy: {...sharing.policy, visibility: "private"}})
        return "ok" as const
    }

    return (
        <div className="flex flex-col items-end gap-3">
            {sharing ? (
                <SessionShareButton sharing={sharing} onClick={() => setOpen(true)} />
            ) : null}
            <SessionShareDialog
                open={open}
                onOpenChange={setOpen}
                sessionName="Refund for order 4411"
                projectName="Acme support"
                sharing={sharing}
                disclosure={DISCLOSURE}
                loading={loading}
                loadError={loadError}
                onRetry={() => {}}
                people={PEOPLE}
                members={PEOPLE.filter((m) =>
                    (m.name ?? "").toLowerCase().startsWith(search.toLowerCase()),
                )}
                membersSearch={search}
                onMembersSearch={setSearch}
                onUpsertGrant={upsert}
                onRevokeGrant={revoke}
                onSetVisibility={setVisibility}
                onOnlyMe={onlyMe}
                onCopyLink={() => {}}
                onNotify={setToast}
                onReload={() => {}}
                usesPersonalAccounts={usesPersonalAccounts}
            />
            {toast ? <p className="m-0 text-sm text-muted-foreground">Toast: {toast}</p> : null}
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/Sharing/SessionDialog",
    component: ShareDialogStory,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'The chat Share dialog (@agenta/sessions-ui). Narrowing changes apply at once; Invite, raising a role to "Can send" and "Shared with project" open the disclosure first.',
            },
        },
    },
} satisfies Meta<typeof ShareDialogStory>
export default meta
type Story = StoryObj<typeof meta>

export const EmptyGrants: Story = {args: {initial: state()}}
/** The agent uses each person's own accounts for some items: one line says what sharing shows. */
export const AgentUsesPersonalAccounts: Story = {
    args: {initial: state(), usesPersonalAccounts: true},
}
export const WithPeople: Story = {
    args: {
        initial: state({
            policy: {visibility: "project", owner_user_id: alice.user_id},
            grants: [grant(bob.user_id, "participant"), grant(carol.user_id, "viewer")],
        }),
    },
}
export const ReadOnlyNotOwner: Story = {
    args: {initial: state({my_role: "viewer", can_send: false})},
}
export const ConflictError: Story = {
    args: {initial: state(), result: "conflict"},
    parameters: {docs: {description: {story: "Invite someone and confirm to see the 409 note."}}},
}
export const InvalidGrantee: Story = {
    args: {initial: state(), invalidUserIds: [bob.user_id]},
    parameters: {
        docs: {description: {story: "Invite Bob Lee and Carol Ng: Bob stays as a red chip."}},
    },
}
export const SaveFailed: Story = {
    args: {
        initial: state({grants: [grant(carol.user_id, "viewer")]}),
        result: "failed",
    },
}
export const Loading: Story = {args: {initial: null, loading: true}}
export const LoadError: Story = {args: {initial: null, loadError: true}}

function Chips() {
    const viewer = state({my_role: "viewer", can_send: false})
    return (
        <div className="flex flex-wrap items-start gap-6">
            <SessionShareButton sharing={state({shareable: false})} onClick={() => {}} />
            <SessionAccessChip sharing={viewer} owner={alice} />
            <SessionAccessChip sharing={state({my_role: "participant"})} owner={alice} />
            <SessionAccessChip
                sharing={state({
                    my_role: "viewer",
                    can_send: false,
                    owner_is_active: false,
                    policy: {visibility: "project", owner_user_id: alice.user_id},
                })}
                owner={alice}
            />
            <SessionAccessChip
                sharing={state({
                    my_role: "viewer",
                    can_send: false,
                    shareable: false,
                    policy: {visibility: "project", owner_user_id: null},
                })}
                fromChannel
            />
            <SessionAccessChip
                sharing={state({
                    my_role: "viewer",
                    can_send: false,
                    shareable: false,
                    policy: {visibility: "project", owner_user_id: null},
                })}
            />
        </div>
    )
}

/** Not the owner: View only, Can send, owner left (locked), Slack chat, no owner. */
export const NotOwnerChips: Story = {
    args: {initial: null},
    render: () => <Chips />,
}

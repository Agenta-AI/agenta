import {useState} from "react"

import type {AgentSharingState, ShareDisclosure} from "@agenta/entities/sharing"
import {
    AgentPrivacyControl,
    AgentPrivacyDialog,
    type AgentChannelConnection,
    type SharingWriteResult,
} from "@agenta/entity-ui/sharing"
import type {Meta, StoryObj} from "@storybook/nextjs"

const alice = {user_id: "u-alice", email: "alice@acme.com", name: "Alice Martin"}
const MEMBERS = [
    alice,
    {user_id: "u-bob", email: "bob@acme.com", name: "Bob Lee"},
    {user_id: "u-carol", email: "carol@acme.com", name: "Carol Ng"},
]
const DISCLOSURE: ShareDisclosure = {
    connections: [
        {provider: "gmail", integration: "composio", connection: "c1"},
        {provider: "shopify", integration: "composio", connection: "c2"},
    ],
    turns_use_run_credentials: true,
    files_and_tool_results_shared: true,
    trace_readers_can_read: true,
}

const state = (over: Partial<AgentSharingState> = {}): AgentSharingState => ({
    policy: {visibility: "private", owner_user_id: alice.user_id},
    owner_is_active: true,
    my_role: "owner",
    can_take_ownership: false,
    ...over,
})

interface PrivacyStoryProps {
    initial: AgentSharingState | null
    loading?: boolean
    loadError?: boolean
    result?: SharingWriteResult
    channelConnections?: AgentChannelConnection[]
    channelsOff?: string[]
    showDialog?: boolean
}

function Privacy({
    initial,
    loading,
    loadError,
    result = "ok",
    channelConnections,
    channelsOff,
    showDialog = true,
}: PrivacyStoryProps) {
    const [sharing, setSharing] = useState(initial)
    const [open, setOpen] = useState(showDialog)
    const [search, setSearch] = useState("")
    const [toast, setToast] = useState<string | null>(null)
    const props = {
        agentName: "Support triage",
        projectName: "Acme support",
        sharing,
        disclosure: DISCLOSURE,
        loading,
        loadError,
        onRetry: () => {},
        owner: alice,
        channelConnections,
        channelsOff,
        onOpenChannels: () => setToast("Open Channels"),
        members: MEMBERS.filter((m) =>
            (m.name ?? "").toLowerCase().startsWith(search.toLowerCase()),
        ),
        membersSearch: search,
        onMembersSearch: setSearch,
        onSetVisibility: async (visibility: "private" | "project") => {
            if (result === "ok" && sharing) {
                setSharing({...sharing, policy: {...sharing.policy, visibility}})
            }
            return result
        },
        onTransfer: async () => result,
        onTakeOwnership: async () => result,
        onNotify: setToast,
    }
    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-end gap-2 border-0 border-b border-solid border-border p-2">
                <AgentPrivacyControl {...props} />
            </div>
            <AgentPrivacyDialog {...props} open={open} onOpenChange={setOpen} />
            {toast ? <p className="m-0 text-sm text-muted-foreground">Toast: {toast}</p> : null}
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/Sharing/AgentPrivacy",
    component: Privacy,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'The playground top bar dropdown (fixed 92 px) and the "Privacy and owner" dialog. Picking the other card opens its confirm; nothing changes before.',
            },
        },
    },
} satisfies Meta<typeof Privacy>
export default meta
type Story = StoryObj<typeof meta>

export const OwnerPrivate: Story = {args: {initial: state()}}
export const OwnerShared: Story = {
    args: {initial: state({policy: {visibility: "project", owner_user_id: alice.user_id}})},
}
export const ReadOnlyNotOwner: Story = {
    args: {
        initial: state({
            policy: {visibility: "project", owner_user_id: alice.user_id},
            my_role: "viewer",
        }),
    },
}
export const LockedOwnerLeft: Story = {
    args: {
        initial: state({
            policy: {visibility: "project", owner_user_id: alice.user_id},
            owner_is_active: false,
            my_role: "viewer",
        }),
    },
}
export const TakeOwnership: Story = {
    args: {
        initial: state({
            policy: {visibility: "project", owner_user_id: alice.user_id},
            owner_is_active: false,
            my_role: "viewer",
            can_take_ownership: true,
        }),
    },
}
export const NoOwner: Story = {
    args: {
        initial: state({
            policy: {visibility: "project", owner_user_id: null},
            my_role: "viewer",
            can_take_ownership: true,
        }),
    },
}
export const OwnerCameBack: Story = {
    args: {...TakeOwnership.args, result: "owner_active"} as PrivacyStoryProps,
}
export const ConflictError: Story = {
    args: {
        initial: state({policy: {visibility: "project", owner_user_id: alice.user_id}}),
        result: "conflict",
    },
    parameters: {docs: {description: {story: 'Pick "Private" and confirm to see the 409 note.'}}},
}
export const SlackWarning: Story = {
    args: {
        initial: state({policy: {visibility: "project", owner_user_id: alice.user_id}}),
        channelConnections: [{platform: "Slack", workspace: "Acme workspace"}],
    },
    parameters: {docs: {description: {story: 'Pick "Private" to see the channel warning.'}}},
}
export const SlackStillOff: Story = {
    args: {
        initial: state({policy: {visibility: "project", owner_user_id: alice.user_id}}),
        channelsOff: ["Slack"],
    },
}
export const Loading: Story = {args: {initial: null, loading: true}}
export const LoadError: Story = {args: {initial: null, loadError: true}}

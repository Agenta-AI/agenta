import {useState} from "react"

import type {BrowserProfile} from "@agenta/entities/browserProfile"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: agentTemplate internals are not re-exported from the DrillInView barrel.
import {
    readBrowserAccess,
    type BrowserAccess,
} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/browserAccess"
import {BrowserAccessControlView} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/BrowserAccessControl"

const profile = (
    id: string,
    name: string,
    hosts: string[],
    state: BrowserProfile["state"] = "ready",
): BrowserProfile => ({
    id,
    name,
    allowed_hosts: hosts,
    state,
    generation: state === "ready" ? 1 : 0,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-08T10:00:00Z",
    created_by_id: "user-1",
})

const PROFILES = [
    profile("p1", "Work GitHub", ["github.com"]),
    profile("p2", "Analytics", ["cloud.umami.is", "plausible.io"]),
    profile("p3", "Pending login", ["linear.app"], "pending_login"),
]

/** Holds the access value so the control can be clicked through like in the drawer. */
const Interactive = ({
    initial,
    profiles,
    loadFailed,
    disabled,
}: {
    initial: BrowserAccess
    profiles: BrowserProfile[] | null
    loadFailed?: boolean
    disabled?: boolean
}) => {
    const [access, setAccess] = useState(initial)
    return (
        <div className="flex w-[400px] flex-col gap-3">
            <BrowserAccessControlView
                access={access}
                profiles={profiles}
                loadFailed={loadFailed}
                disabled={disabled}
                onChange={setAccess}
            />
            <pre className="m-0 rounded bg-colorFillTertiary p-2 text-[11px] text-colorTextSecondary">
                {JSON.stringify({browser: access.mode === "all" ? undefined : access}, null, 2)}
            </pre>
        </div>
    )
}

const meta = {
    title: "@agenta/entity-ui/DrillIn/BrowserAccessControl",
    component: Interactive,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The Browser panel of the agent's Advanced drawer: which of the user's ready browser logins the agent may use. The JSON below shows what the control writes to `parameters.agent.browser` (absent = all).",
            },
        },
    },
    args: {initial: {mode: "all"}, profiles: PROFILES},
} satisfies Meta<typeof Interactive>

export default meta
type Story = StoryObj<typeof meta>

export const AllMyLogins: Story = {}

export const OnlyTheseLogins: Story = {
    args: {initial: {mode: "selected", profiles: ["p1"]}},
}

export const OnlyTheseNothingChecked: Story = {
    args: {initial: {mode: "selected", profiles: []}},
}

/** The pre-modes `{profile: id}` shape reads as that one login checked. */
export const LegacySingleProfile: Story = {
    args: {initial: readBrowserAccess({profile: "p2"})},
}

/** An id the user can no longer use is not listed and drops out on the next toggle. */
export const UnknownLoginId: Story = {
    args: {initial: {mode: "selected", profiles: ["gone", "p1"]}},
}

export const Off: Story = {
    args: {initial: {mode: "off"}},
}

export const NoLogins: Story = {
    args: {profiles: []},
}

export const Loading: Story = {
    args: {profiles: null},
}

export const LoadFailed: Story = {
    args: {profiles: null, loadFailed: true},
}

export const ReadOnly: Story = {
    args: {initial: {mode: "selected", profiles: ["p1"]}, disabled: true},
}

import type {BrowserProfile} from "@agenta/entities/browserProfile"
import {BrowserLoginsPage} from "@agenta/settings-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const noop = () => undefined

const meta = {
    title: "@agenta/settings-ui/Browser/BrowserLoginsPage",
    component: BrowserLoginsPage,
    parameters: {layout: "padded"},
    args: {
        rows: [],
        loading: false,
        onCreate: noop,
        onLogin: noop,
        onEditSites: noop,
        onDelete: noop,
    },
} satisfies Meta<typeof BrowserLoginsPage>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

const profile = (
    id: string,
    name: string,
    hosts: string[],
    state: BrowserProfile["state"],
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

export const WithLogins: Story = {
    args: {
        rows: [
            profile("p1", "Work GitHub", ["github.com"], "ready"),
            profile("p2", "Umami analytics", ["cloud.umami.is"], "pending_login"),
        ],
    },
}

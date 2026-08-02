import {connectionDrawerAtom} from "@agenta/entities/gatewayTool"
import {ConnectionManagerDrawer} from "@agenta/entity-ui/gatewayTool"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ConnectionManagerDrawer — atom-driven container (connectionDrawerAtom opens it, the
// connection arrives via the ["tools","connections",id] query). Data-seam story: the atom
// seed opens the drawer, the query fixture provides the connection.
//
// Ids are per-story unique CONSTANTS, not `scope.id(...)`: the seam's `atoms` channel is a
// static array (it never receives the scope), and the id must match between the atom seed
// and the query fixture. Uniqueness across stories is what prevents `atomFamily` collisions,
// and each id below appears in exactly one story.
//
// antd `Drawer` → `EnhancedDrawer` (Sheet facade); `Descriptions bordered` → composed
// detail table; icon+loading Buttons → `LoadingButton`; `Spin` → `Spinner`.
// Showcase story (drawer renders in a portal — not a grid parity pair).
const meta = {
    title: "@agenta/entity-ui/GatewayTool/ConnectionManagerDrawer",
    component: ConnectionManagerDrawer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Connection details drawer: status badge, bordered detail table (was antd `Descriptions`), Test/Refresh/Revoke/Delete actions. Opens from `connectionDrawerAtom`; data from the seeded connection query.",
            },
        },
    },
} satisfies Meta<typeof ConnectionManagerDrawer>

export default meta
type Story = StoryObj

const connection = (id: string, flags: {is_active: boolean; is_valid: boolean}) => ({
    id,
    slug: "my-github",
    name: "My GitHub",
    provider_key: "composio",
    integration_key: "github",
    flags,
    created_at: "2026-07-01T09:30:00Z",
})

const seam = (id: string, flags: {is_active: boolean; is_valid: boolean}) => ({
    atoms: [[connectionDrawerAtom, {connectionId: id}]] as [typeof connectionDrawerAtom, unknown][],
    queries: [[["tools", "connections", id], {count: 1, connection: connection(id, flags)}]] as [
        unknown[],
        unknown,
    ][],
})

/** Healthy connection — all actions enabled. */
export const Connected: Story = {
    parameters: {agenta: seam("conn-gtool-mgr-connected", {is_active: true, is_valid: true})},
}

/** Pending auth — Test and Revoke disabled, badge shows Pending. */
export const Pending: Story = {
    parameters: {agenta: seam("conn-gtool-mgr-pending", {is_active: true, is_valid: false})},
}

/** Unknown id — the "Connection not found." branch. */
export const NotFound: Story = {
    parameters: {
        agenta: {
            atoms: [[connectionDrawerAtom, {connectionId: "conn-gtool-mgr-ghost"}]],
            queries: [
                [["tools", "connections", "conn-gtool-mgr-ghost"], {count: 0, connection: null}],
            ],
        },
    },
}

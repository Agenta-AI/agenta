import type {WorkspaceMember} from "@agenta/entities/organization"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, within} from "storybook/test"

import {MemberRoleCell} from "../../../mobile/src/features/settings/MemberRoleCell"

const member = (status: WorkspaceMember["user"]["status"]): WorkspaceMember => ({
    user: {
        id: "user-alice",
        email: "alice@example.com",
        username: "Alice",
        status,
        created_at: "2026-01-15T00:00:00Z",
    },
    roles: [{role_name: "admin", role_description: "Administrator", permissions: []}],
})

const meta = {
    title: "@agenta/mobile/Settings/MemberRoleCell",
    component: MemberRoleCell,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The member table's role cell from web/mobile: a picker for a reader who may change the role, a plain label for everyone else.",
            },
        },
    },
    args: {
        member: member("member"),
        isOwner: false,
        offeredRoles: ["admin", "editor", "viewer"],
        canChange: true,
        onChange: () => undefined,
    },
    decorators: [
        (Story) => (
            <div className="w-72">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof MemberRoleCell>

export default meta
type Story = StoryObj<typeof meta>

/** A reader with permission gets the role picker, set to the member's current role. */
export const Editable: Story = {
    play: async ({canvasElement}) => {
        await expect(within(canvasElement).getByRole("combobox", {name: "Role"})).toHaveTextContent(
            "Admin",
        )
    },
}

/** A reader without permission sees a plain role label. */
export const ReadOnly: Story = {
    args: {canChange: false},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText("Admin")).toBeInTheDocument()
        await expect(canvas.queryByRole("combobox")).not.toBeInTheDocument()
    },
}

/** The owner's role is a label whatever the reader may do. */
export const Owner: Story = {
    args: {isOwner: true},
    play: async ({canvasElement}) => {
        await expect(within(canvasElement).queryByRole("combobox")).not.toBeInTheDocument()
    },
}

/** An invitation has no membership to change, so it shows a label. */
export const PendingInvitation: Story = {
    args: {member: member("pending")},
    play: async ({canvasElement}) => {
        await expect(within(canvasElement).queryByRole("combobox")).not.toBeInTheDocument()
    },
}

/** The picker is replaced by a skeleton while this member's change is in flight. */
export const Saving: Story = {
    args: {pending: true},
    play: async ({canvasElement}) => {
        await expect(within(canvasElement).queryByRole("combobox")).not.toBeInTheDocument()
    },
}

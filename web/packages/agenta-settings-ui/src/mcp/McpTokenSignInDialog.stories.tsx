import type {Meta, StoryObj} from "@storybook/nextjs"

import {McpTokenSignInDialog} from "./McpTokenSignInDialog"

/** A token server's personal sign-in, from "Sign in" on MCPs → "Yours". */
const meta = {
    title: "@agenta/settings-ui/Mcp/McpTokenSignInDialog",
    component: McpTokenSignInDialog,
    parameters: {layout: "padded"},
    args: {
        open: true,
        serverName: "GitHub",
        onSubmit: async () => true,
        onClose: () => undefined,
    },
} satisfies Meta<typeof McpTokenSignInDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A token the server refused, said in words a person can read. */
export const Refused: Story = {args: {error: "Could not save the token. Check it and try again."}}

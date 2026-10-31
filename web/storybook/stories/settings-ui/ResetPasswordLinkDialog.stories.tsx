import type {WorkspaceMember} from "@agenta/entities/organization"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {ResetPasswordLinkDialog} from "../../../mobile/src/features/settings/ResetPasswordLinkDialog"

const MEMBER: WorkspaceMember = {
    user: {
        id: "user-alice",
        email: "alice@example.com",
        username: "Alice",
        status: "member",
        created_at: "2026-01-15T00:00:00Z",
    },
    roles: [],
}

const LINK = "https://app.example.invalid/reset/one-time-link"

const resolvedRequest: (member: WorkspaceMember) => Promise<string> = async () => LINK

const pendingRequest: (member: WorkspaceMember) => Promise<string> = () =>
    new Promise(() => undefined)

const failedRequest: (member: WorkspaceMember) => Promise<string> = async () => {
    throw {
        statusCode: 403,
        body: {detail: "The organization owner's password cannot be reset this way."},
    }
}

const generate = async (canvasElement: HTMLElement) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(await screen.findByRole("button", {name: "Generate link"}))
}

const meta = {
    title: "@agenta/mobile/Settings/ResetPasswordLinkDialog",
    component: ResetPasswordLinkDialog,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "The one-time password reset link dialog from web/mobile. The request is pending, resolved to a dummy example.invalid link, or refused by the server.",
            },
        },
    },
    args: {
        target: MEMBER,
        onRequest: resolvedRequest,
        onClose: () => undefined,
    },
} satisfies Meta<typeof ResetPasswordLinkDialog>

export default meta
type Story = StoryObj<typeof meta>

/** The first step: nothing is requested until the reader confirms. */
export const Confirm: Story = {
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("button", {name: "Generate link"})).toBeEnabled()
        await expect(screen.queryByText(LINK)).not.toBeInTheDocument()
    },
}

/** The request has not resolved, so no link exists in the document yet. */
export const Loading: Story = {
    args: {onRequest: pendingRequest},
    play: async ({canvasElement}) => {
        await generate(canvasElement)
        const screen = within(canvasElement.ownerDocument.body)
        await expect(screen.getByText("Generating a one-time link…")).toBeInTheDocument()
        await expect(screen.queryByText(LINK)).not.toBeInTheDocument()
    },
}

/** The resolved one-time link, ready to copy. The host is example.invalid. */
export const Resolved: Story = {
    play: async ({canvasElement}) => {
        await generate(canvasElement)
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByText(LINK)).toBeInTheDocument()
        await expect(screen.getByRole("button", {name: "Copy"})).toBeInTheDocument()
    },
}

/** A refused request shows only the server's safe message, never a link. */
export const ServerError: Story = {
    args: {onRequest: failedRequest},
    play: async ({canvasElement}) => {
        await generate(canvasElement)
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("alert")).toHaveTextContent(
            "The organization owner's password cannot be reset this way.",
        )
        await expect(screen.queryByText(LINK)).not.toBeInTheDocument()
    },
}

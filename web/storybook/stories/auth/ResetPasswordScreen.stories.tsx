import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {ResetPasswordScreen} from "../../../mobile/src/features/auth/ResetPasswordScreen"

const withQuery = (query: Record<string, string>) => ({
    nextjs: {router: {pathname: "/auth/reset-password", query, isReady: true}},
})

const meta = {
    title: "@agenta/mobile/Auth/ResetPasswordScreen",
    component: ResetPasswordScreen,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The page a member password reset link opens in web/mobile. The success state needs a real SuperTokens answer, so it has no story.",
            },
        },
    },
} satisfies Meta<typeof ResetPasswordScreen>

export default meta
type Story = StoryObj<typeof meta>

export const Form: Story = {
    parameters: withQuery({token: "example-token", tenantId: "public"}),
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByRole("heading", {name: "Set a new password"})).toBeVisible()
    },
}

export const PasswordsDoNotMatch: Story = {
    parameters: withQuery({token: "example-token", tenantId: "public"}),
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.type(await canvas.findByLabelText("New password"), "First-pass1!")
        await userEvent.type(canvas.getByLabelText("Confirm new password"), "Second-pass1!")
        await userEvent.click(canvas.getByRole("button", {name: "Set password"}))
        await expect(await canvas.findByRole("alert")).toHaveTextContent(
            "The passwords do not match.",
        )
    },
}

export const LinkWithoutToken: Story = {
    parameters: withQuery({}),
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await expect(
            await canvas.findByRole("heading", {name: "This link no longer works"}),
        ).toBeVisible()
    },
}

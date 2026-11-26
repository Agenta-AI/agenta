import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {AddDomainDialog} from "../../../mobile/src/features/settings/AddDomainDialog"

// The Add domain sheet from Settings > Access & Security. Submission is a story callback, so
// every state is reachable without a request. Domains use the reserved `.invalid` suffix.
const meta = {
    title: "Settings/AccessSecurity/AddDomainDialog",
    component: AddDomainDialog,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Add a domain to the organization. The dialog collects the domain name; the backend returns the verification token that the DNS instructions show. Submission is supplied by the caller, so these stories exercise the real form without a network.",
            },
        },
    },
    argTypes: {onSubmit: {action: "submit"}},
} satisfies Meta<typeof AddDomainDialog>

export default meta
type Story = StoryObj<typeof AddDomainDialog>

const DOMAIN = "company.example.invalid"

const noop = () => undefined
const pendingSubmit = () => new Promise<void>(() => undefined)
const rejectedSubmit = () => Promise.reject(new Error("Domain already verified"))

const typeAndSubmit = async (canvasElement: HTMLElement, domain: string) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.type(await screen.findByPlaceholderText("company.com"), domain)
    await userEvent.click(await screen.findByRole("button", {name: "Add domain"}))
}

/** The empty form. Add domain stays disabled until the field has a value. */
export const Initial: Story = {
    render: () => <AddDomainDialog open onClose={noop} onSubmit={() => Promise.resolve()} />,
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("button", {name: "Add domain"})).toBeDisabled()
    },
}

/** A valid domain is being added: the primary button reads Adding… and both actions lock. */
export const Pending: Story = {
    render: () => <AddDomainDialog open onClose={noop} onSubmit={pendingSubmit} />,
    play: async ({canvasElement}) => {
        await typeAndSubmit(canvasElement, DOMAIN)
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("button", {name: "Adding…"})).toBeDisabled()
        await expect(screen.getByRole("button", {name: "Cancel"})).toBeDisabled()
    },
}

/** The server refused the domain: the typed value stays and the alert shows a plain message. */
export const SubmitError: Story = {
    render: () => <AddDomainDialog open onClose={noop} onSubmit={rejectedSubmit} />,
    play: async ({canvasElement}) => {
        await typeAndSubmit(canvasElement, DOMAIN)
        const screen = within(canvasElement.ownerDocument.body)
        await expect(await screen.findByRole("alert")).toHaveTextContent("Could not add the domain")
        await expect(screen.getByPlaceholderText("company.com")).toHaveValue(DOMAIN)
    },
}

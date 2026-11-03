import type {OrganizationProvider} from "@agenta/entities/organization"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {
    SsoProviderDialog,
    type SsoProviderFormValues,
} from "../../../mobile/src/features/settings/SsoProviderDialog"

// The OIDC provider dialog from Settings > Access & Security. The stored client secret is never
// part of the fixture: the API does not return it, and an edit always starts with a blank field.
const PROVIDER: OrganizationProvider = {
    id: "provider-story-1",
    slug: "acme-okta",
    organization_id: "organization-story-1",
    name: "Acme Okta",
    description: "Primary identity provider",
    flags: {is_valid: true, is_active: false},
    settings: {
        issuer_url: "https://idp.example.invalid",
        client_id: "agenta-story-client",
        has_client_secret: true,
        scopes: ["openid", "profile", "email"],
    },
    created_at: "2026-01-15T10:00:00.000Z",
    updated_at: null,
}

const noop = () => undefined
const resolveSubmit = () => Promise.resolve()
const rejectSubmit = () => Promise.reject(new Error("The provider could not be reached"))

const blankSecretCapture: {payload: SsoProviderFormValues | null} = {payload: null}
const getBlankSecretPayload = (): SsoProviderFormValues | null => blankSecretCapture.payload
const captureBlankSecretSubmit = async (values: SsoProviderFormValues) => {
    blankSecretCapture.payload = values
}

const meta = {
    title: "Settings/AccessSecurity/SsoProviderDialog",
    component: SsoProviderDialog,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Create or edit an OIDC provider. An edit never receives the stored client secret, so a blank secret field keeps the stored value and the payload omits `client_secret`. Submission is supplied by the caller; these stories use no network.",
            },
        },
    },
    argTypes: {onSubmit: {action: "submit"}},
} satisfies Meta<typeof SsoProviderDialog>

export default meta
type Story = StoryObj<typeof SsoProviderDialog>

/** A new provider: every field starts blank, with the default openid/profile/email scopes. */
export const Create: Story = {
    render: () => (
        <SsoProviderDialog open provider={null} onClose={noop} onSubmit={resolveSubmit} />
    ),
}

/** Editing a stored provider: its public settings are prefilled and the secret field is blank. */
export const Edit: Story = {
    render: () => (
        <SsoProviderDialog open provider={PROVIDER} onClose={noop} onSubmit={resolveSubmit} />
    ),
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await expect(screen.getByPlaceholderText("okta")).toHaveValue(PROVIDER.slug)
        await expect(screen.getByPlaceholderText("https://idp.example.com")).toHaveValue(
            PROVIDER.settings.issuer_url,
        )
        await expect(screen.getByDisplayValue("agenta-story-client")).toBeInTheDocument()
        const secret =
            canvasElement.ownerDocument.querySelector<HTMLInputElement>('input[type="password"]')
        await expect(secret?.value).toBe("")
        await expect(
            screen.getByText("The stored secret is never shown. Leave blank to keep it."),
        ).toBeInTheDocument()
    },
}

/**
 * Saving an untouched edit keeps the stored secret: the password field stays blank and the
 * submitted payload has no `client_secret` key.
 */
export const BlankSecretPreservation: Story = {
    render: () => (
        <SsoProviderDialog
            open
            provider={PROVIDER}
            onClose={noop}
            onSubmit={captureBlankSecretSubmit}
        />
    ),
    play: async ({canvasElement}) => {
        blankSecretCapture.payload = null
        const screen = within(canvasElement.ownerDocument.body)
        await userEvent.click(await screen.findByRole("button", {name: "Save provider"}))
        await expect(getBlankSecretPayload()).not.toBeNull()
        await expect(getBlankSecretPayload()?.settings).not.toHaveProperty("client_secret")
    },
}

/** The save failed: the dialog stays open with a plain message in an alert. */
export const SubmitError: Story = {
    render: () => (
        <SsoProviderDialog open provider={PROVIDER} onClose={noop} onSubmit={rejectSubmit} />
    ),
    play: async ({canvasElement}) => {
        const screen = within(canvasElement.ownerDocument.body)
        await userEvent.click(await screen.findByRole("button", {name: "Save provider"}))
        await expect(await screen.findByRole("alert")).toHaveTextContent(
            "Could not save the provider",
        )
    },
}

// @vitest-environment jsdom
import {act} from "react"

import type {OrganizationProvider} from "@agenta/entities/organization"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

import {SsoProviderDialog} from "@/features/settings/SsoProviderDialog"

const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
    )
const inputs = () => Array.from(document.querySelectorAll("input")) as HTMLInputElement[]

const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const PROVIDER = {
    id: "prov-1",
    slug: "okta",
    name: "Okta",
    description: "Primary IdP",
    flags: {is_valid: true, is_active: true},
    settings: {
        issuer_url: "https://idp.example.com",
        client_id: "client-1",
        client_secret: "stored-secret",
        scopes: ["openid", "email"],
    },
} as unknown as OrganizationProvider

describe("SsoProviderDialog", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("creates a provider with the complete settings payload", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <SsoProviderDialog open provider={null} onClose={vi.fn()} onSubmit={onSubmit} />,
            )
        })

        const [slug, , , issuer, clientId, secret, scopes] = inputs()
        await typeInto(slug, "okta")
        await typeInto(issuer, "https://idp.example.com")
        await typeInto(clientId, "client-1")
        await typeInto(secret, "new-secret")
        await typeInto(scopes, "openid, profile, email")

        await act(async () => {
            button("Add provider")!.click()
        })

        expect(onSubmit).toHaveBeenCalledWith({
            slug: "okta",
            settings: {
                issuer_url: "https://idp.example.com",
                client_id: "client-1",
                client_secret: "new-secret",
                scopes: ["openid", "profile", "email"],
            },
        })
    })

    it("prefills an edit without revealing the stored secret and omits a blank one", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <SsoProviderDialog
                    open
                    provider={PROVIDER}
                    onClose={vi.fn()}
                    onSubmit={onSubmit}
                />,
            )
        })

        expect(document.body.textContent).toContain(
            "Saving settings clears validation and deactivates the provider. Enable it again after saving.",
        )
        const [slug, name, description, issuer, clientId, secret, scopes] = inputs()
        expect(slug.value).toBe("okta")
        expect(name.value).toBe("Okta")
        expect(description.value).toBe("Primary IdP")
        expect(issuer.value).toBe("https://idp.example.com")
        expect(clientId.value).toBe("client-1")
        expect(secret.value).toBe("")
        expect(scopes.value).toBe("openid, email")
        expect(document.body.textContent).not.toContain("stored-secret")

        await act(async () => {
            button("Save provider")!.click()
        })

        expect(onSubmit).toHaveBeenCalledWith({
            name: "Okta",
            description: "Primary IdP",
            settings: {
                issuer_url: "https://idp.example.com",
                client_id: "client-1",
                scopes: ["openid", "email"],
            },
        })
        expect(onSubmit.mock.calls[0][0].settings).not.toHaveProperty("client_secret")
    })

    it("sends empty name and description when an edit clears them", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <SsoProviderDialog
                    open
                    provider={PROVIDER}
                    onClose={vi.fn()}
                    onSubmit={onSubmit}
                />,
            )
        })
        const [, name, description] = inputs()
        await typeInto(name, "")
        await typeInto(description, "")
        await act(async () => {
            button("Save provider")!.click()
        })

        expect(onSubmit.mock.calls[0][0]).toMatchObject({name: "", description: ""})
    })

    it("sends the slug on edit only when it changed", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <SsoProviderDialog
                    open
                    provider={PROVIDER}
                    onClose={vi.fn()}
                    onSubmit={onSubmit}
                />,
            )
        })
        await typeInto(inputs()[0], "okta-two")
        await act(async () => {
            button("Save provider")!.click()
        })

        expect(onSubmit.mock.calls[0][0].slug).toBe("okta-two")
    })

    it("sends a typed secret on edit", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <SsoProviderDialog
                    open
                    provider={PROVIDER}
                    onClose={vi.fn()}
                    onSubmit={onSubmit}
                />,
            )
        })

        await typeInto(inputs()[5], "replacement-secret")
        await act(async () => {
            button("Save provider")!.click()
        })

        expect(onSubmit.mock.calls[0][0].settings.client_secret).toBe("replacement-secret")
    })

    it("blocks submit for an invalid slug", async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <SsoProviderDialog open provider={null} onClose={vi.fn()} onSubmit={onSubmit} />,
            )
        })

        const [slug, , , issuer, clientId, secret] = inputs()
        await typeInto(slug, "Okta One")
        await typeInto(issuer, "https://idp.example.com")
        await typeInto(clientId, "client-1")
        await typeInto(secret, "new-secret")
        await act(async () => {
            button("Add provider")!.click()
        })

        expect(onSubmit).not.toHaveBeenCalled()
        expect(document.querySelector("[role=alert]")?.textContent).toContain("lowercase letters")
    })
})

// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    updateOrganizationSlug: vi.fn(),
}))

vi.mock("@agenta/entities/organization", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    organizationAccessApi: {
        updateOrganizationSlug: fixture.updateOrganizationSlug,
    },
}))

import {OrganizationSlugField} from "@/features/settings/OrganizationSlugField"

const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === label,
    )

const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

describe("OrganizationSlugField", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        fixture.updateOrganizationSlug.mockReset().mockResolvedValue(undefined)
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("shows a present slug read-only", async () => {
        await act(async () => {
            root.render(<OrganizationSlugField organizationId="org-1" slug="acme" canEdit />)
        })

        expect(document.body.textContent).toContain("acme")
        expect(document.body.textContent).toContain("cannot be changed")
        expect(document.querySelector("input")).toBeNull()
        expect(button("Save slug")).toBeUndefined()
    })

    it("saves a missing slug once and shows it read-only", async () => {
        const onSaved = vi.fn().mockResolvedValue(undefined)
        await act(async () => {
            root.render(
                <OrganizationSlugField
                    organizationId="org-1"
                    slug={null}
                    canEdit
                    onSaved={onSaved}
                />,
            )
        })

        await typeInto(document.querySelector("input") as HTMLInputElement, "my-org")
        await act(async () => {
            button("Save slug")!.click()
        })

        expect(fixture.updateOrganizationSlug).toHaveBeenCalledTimes(1)
        expect(fixture.updateOrganizationSlug).toHaveBeenCalledWith("org-1", "my-org")
        expect(onSaved).toHaveBeenCalled()
        expect(document.querySelector("input")).toBeNull()
        expect(document.body.textContent).toContain("my-org")
    })

    it("rejects uppercase letters before calling the API", async () => {
        await act(async () => {
            root.render(<OrganizationSlugField organizationId="org-1" slug={null} canEdit />)
        })

        await typeInto(document.querySelector("input") as HTMLInputElement, "My-Org")
        await act(async () => {
            button("Save slug")!.click()
        })

        expect(fixture.updateOrganizationSlug).not.toHaveBeenCalled()
        expect(document.querySelector("[role=alert]")?.textContent).toContain("lowercase letters")
    })

    it("shows a conflict without losing the input", async () => {
        fixture.updateOrganizationSlug.mockRejectedValue({statusCode: 409})
        await act(async () => {
            root.render(<OrganizationSlugField organizationId="org-1" slug={null} canEdit />)
        })

        const input = document.querySelector("input") as HTMLInputElement
        await typeInto(input, "taken-slug")
        await act(async () => {
            button("Save slug")!.click()
        })

        expect(input.value).toBe("taken-slug")
        expect(document.querySelector("[role=alert]")?.textContent).toBe(
            "That slug is already taken. Choose another.",
        )
    })
})

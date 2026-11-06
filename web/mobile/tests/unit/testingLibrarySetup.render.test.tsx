// @vitest-environment jsdom
import type {OrganizationDomain} from "@agenta/entities/organization"
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {DomainDnsInstructions} from "@/features/settings/DomainDnsInstructions"

const domain = (token: string | null) =>
    ({id: "dom-1", slug: "example.com", token}) as unknown as OrganizationDomain

describe("DomainDnsInstructions with Testing Library", () => {
    afterEach(cleanup)

    it("shows the DNS record to add for an unverified domain", () => {
        render(<DomainDnsInstructions domain={domain("abc123")} />)

        expect(screen.getByText("Name: _agenta-verification.example.com")).toBeTruthy()
        expect(screen.getByText("Value: _agenta-verification=abc123")).toBeTruthy()
        expect(screen.getByRole("button", {name: "Copy value"})).toBeTruthy()
    })

    it("shows nothing when the domain has no token", () => {
        render(<DomainDnsInstructions domain={domain(null)} />)

        expect(screen.queryByRole("button", {name: "Copy value"})).toBeNull()
        expect(screen.queryByText(/_agenta-verification/)).toBeNull()
    })
})

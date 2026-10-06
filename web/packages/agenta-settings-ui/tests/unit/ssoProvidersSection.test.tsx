// @vitest-environment jsdom
/** The inline Enable button sits in a row that opens the edit drawer on click. */
import type {OrganizationProvider} from "@agenta/entities/organization"
import {cleanup, fireEvent, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {SsoProvidersSection} from "../../src/access/SsoProvidersSection"

const PROVIDER = {
    id: "prov-1",
    slug: "okta",
    flags: {is_active: false, is_valid: false},
} as unknown as OrganizationProvider

afterEach(cleanup)

describe("SsoProvidersSection", () => {
    it("enables a provider without opening its edit drawer", () => {
        const onEdit = vi.fn()
        const onEnable = vi.fn()
        render(<SsoProvidersSection providers={[PROVIDER]} onEdit={onEdit} onEnable={onEnable} />)

        fireEvent.click(screen.getByRole("button", {name: "Enable"}))

        expect(onEnable).toHaveBeenCalledWith(PROVIDER)
        expect(onEdit).not.toHaveBeenCalled()
    })

    it("still opens the edit drawer from the row", () => {
        const onEdit = vi.fn()
        render(<SsoProvidersSection providers={[PROVIDER]} onEdit={onEdit} onEnable={vi.fn()} />)

        fireEvent.click(screen.getByText("okta"))

        expect(onEdit).toHaveBeenCalledWith(PROVIDER)
    })
})

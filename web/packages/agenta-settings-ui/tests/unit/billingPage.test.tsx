// @vitest-environment jsdom
import React, {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {BillingPage} from "../../src/billing/BillingPage"
import type {BillingUsage} from "../../src/billing/types"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const metric = (value: number, limit: number | null) => ({
    value,
    limit,
    free: limit ?? 0,
    period: "monthly" as const,
    scope: "organization" as const,
    strict: true,
})

describe("BillingPage Limits grid", () => {
    let container: HTMLDivElement
    let root: Root

    beforeEach(() => {
        container = document.createElement("div")
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    it("lists the platform quotas and leaves out the retired credits meter", () => {
        const usage: BillingUsage = {
            traces_ingested: metric(120, 5000),
            evaluations_run: metric(3, 20),
            credits_consumed: metric(0, 100),
            users: {...metric(1, 2), period: null},
        }

        act(() => root.render(<BillingPage usage={usage} />))

        const text = container.textContent ?? ""
        expect(text).toContain("traces ingested")
        expect(text).toContain("evaluations run")
        expect(text).not.toContain("credits consumed")
    })
})

// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {useSecretDock} from "../../../src/hooks/useSecretDock"

const secretPart = (overrides: Record<string, unknown> = {}) => ({
    type: "tool-request_secret",
    toolCallId: "call_1",
    state: "input-available",
    input: {name: "Stripe key", env_var: "STRIPE_KEY", reason: "to bill"},
    ...overrides,
})

const renderPart = (toolCallId: string) => ({
    type: "data-render",
    data: {toolCallId, render: {kind: "secret"}},
})

const turn = (...parts: unknown[]): UIMessage[] =>
    [{id: "m1", role: "assistant", parts}] as unknown as UIMessage[]

describe("useSecretDock", () => {
    it("opens on a parked secret request and fronts it", () => {
        const {result} = renderHook(() =>
            useSecretDock({messages: turn(secretPart(), renderPart("call_1")), onOutput: vi.fn()}),
        )
        expect(result.current.open).toBe(true)
        expect(result.current.front?.toolCallId).toBe("call_1")
    })

    it("stays closed while disabled", () => {
        const {result} = renderHook(() =>
            useSecretDock({
                messages: turn(secretPart(), renderPart("call_1")),
                enabled: false,
                onOutput: vi.fn(),
            }),
        )
        expect(result.current.open).toBe(false)
    })
})

describe("host-driven dismiss", () => {
    // A chat message sent over a parked secret request replaces it, as the card's "Not now" would.
    it("settles the request as cancelled and closes the dock", async () => {
        const onOutput = vi.fn().mockResolvedValue(true)
        const {result} = renderHook(() =>
            useSecretDock({messages: turn(secretPart(), renderPart("call_1")), onOutput}),
        )

        await act(async () => {
            await result.current.dismiss()
        })

        expect(onOutput).toHaveBeenCalledExactlyOnceWith({
            toolName: "request_secret",
            toolCallId: "call_1",
            output: {status: "cancelled"},
        })
        expect(result.current.open).toBe(false)
    })

    it("re-opens the dock and lets the failure through when the write is refused", async () => {
        const onOutput = vi.fn().mockResolvedValue(false)
        const {result} = renderHook(() =>
            useSecretDock({messages: turn(secretPart(), renderPart("call_1")), onOutput}),
        )

        await act(async () => {
            await expect(result.current.dismiss()).rejects.toThrow("couldn't be dismissed")
        })

        expect(result.current.open).toBe(true)
    })
})

import type {ReactNode} from "react"

import type {AgentModelKeyStatus} from "@agenta/chat/hooks"
import {CONNECT_MODEL_BANNER_MESSAGE, RUNNER_UNAVAILABLE_BANNER_MESSAGE} from "@agenta/chat/hooks"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

vi.mock("../hooks/useOnboardingProviderSetup", () => ({
    useOnboardingProviderSetup: () => ({
        open: false,
        openDrawer: () => undefined,
        closeDrawer: () => undefined,
        connections: [],
        onSaved: () => undefined,
    }),
}))

vi.mock("@agenta/entity-ui/secretProvider", () => ({
    ProviderDrawer: () => null,
}))

vi.mock("jotai", async (original) => {
    const actual = await original<typeof import("jotai")>()
    return {
        ...actual,
        useAtom: () => [false, () => undefined],
    }
})

vi.mock("@agenta/chat/components", () => ({
    RevealCollapse: ({open, children}: {open: boolean; children: ReactNode}) =>
        open ? <div>{children}</div> : null,
}))

const {default: ConnectModelBanner} = await import("./ConnectModelBanner")

const status = (over: Partial<AgentModelKeyStatus> = {}): AgentModelKeyStatus => ({
    provider: null,
    model: null,
    harness: null,
    hasKey: false,
    providerEntry: null,
    loading: false,
    gateActive: false,
    runnerUnavailable: false,
    composerBlocked: false,
    ...over,
})

const render = (over: Partial<AgentModelKeyStatus> = {}) =>
    renderToStaticMarkup(<ConnectModelBanner entityId="rev-1" {...status(over)} />)

describe("ConnectModelBanner", () => {
    it("asks for a provider key when the connect-model gate is active", () => {
        const markup = render({gateActive: true, composerBlocked: true})
        expect(markup).toContain(CONNECT_MODEL_BANNER_MESSAGE)
        expect(markup).toContain("Set up model providers")
    })

    it("does not send the user to providers when the runner is unavailable", () => {
        const markup = render({runnerUnavailable: true, composerBlocked: true})
        expect(markup).toContain(RUNNER_UNAVAILABLE_BANNER_MESSAGE)
        expect(markup).not.toContain(CONNECT_MODEL_BANNER_MESSAGE)
        expect(markup).not.toContain("Set up model providers")
        expect(markup).not.toContain("provider key")
    })

    it("renders nothing when neither lock applies", () => {
        expect(render()).not.toContain(CONNECT_MODEL_BANNER_MESSAGE)
        expect(render()).not.toContain(RUNNER_UNAVAILABLE_BANNER_MESSAGE)
    })
})

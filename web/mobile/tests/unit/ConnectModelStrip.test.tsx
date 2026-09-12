// @vitest-environment jsdom
import type {ReactNode} from "react"

import {CONNECT_MODEL_BANNER_MESSAGE, RUNNER_UNAVAILABLE_BANNER_MESSAGE} from "@agenta/chat/hooks"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/chat/components", () => ({
    RevealCollapse: ({open, children}: {open: boolean; children: ReactNode}) =>
        open ? <div>{children}</div> : null,
}))

vi.mock("../../src/features/settings/ProviderKeySheet", () => ({
    ProviderKeySheet: () => null,
}))

const {ConnectModelStrip} = await import("../../src/features/chat/ConnectModelStrip")

describe("ConnectModelStrip", () => {
    it("asks for a provider key when the connect-model gate is active", () => {
        const markup = renderToStaticMarkup(
            <ConnectModelStrip providerEntry={null} gateActive runnerUnavailable={false} />,
        )
        expect(markup).toContain(CONNECT_MODEL_BANNER_MESSAGE)
        expect(markup).toContain("Add key")
    })

    it("does not send the user to add a key when the runner is unavailable", () => {
        const markup = renderToStaticMarkup(
            <ConnectModelStrip providerEntry={null} gateActive={false} runnerUnavailable />,
        )
        expect(markup).toContain(RUNNER_UNAVAILABLE_BANNER_MESSAGE)
        expect(markup).not.toContain(CONNECT_MODEL_BANNER_MESSAGE)
        expect(markup).not.toContain("Add key")
        expect(markup).not.toContain("provider key")
    })
})

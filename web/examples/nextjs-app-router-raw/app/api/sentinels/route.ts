/**
 * Sentinel inspection endpoint — returns the per-app instrumentation +
 * first-handler timestamps so the assertion-4 client can compare order.
 *
 * Used only by tests; not part of the user-facing app surface.
 */

import {NextResponse} from "next/server"

export const runtime = "nodejs"

export function GET(): Response {
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "app-router-raw"
    const g = globalThis as Record<string, unknown>
    return NextResponse.json({
        appName: APP_NAME,
        runtime: process.env.NEXT_RUNTIME,
        instrumentationAt: g[`__agenta_instr_${APP_NAME}`] ?? null,
        firstHandlerAt: g[`__agenta_first_handler_${APP_NAME}`] ?? null,
    })
}

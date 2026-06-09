/**
 * Sentinel inspection endpoint — TanStack Start edition.
 *
 * Returns the per-app instrumentation + first-handler timestamps so
 * assertion-4 can compare register order.
 */

import {createFileRoute} from "@tanstack/react-router"

export const Route = createFileRoute("/api/sentinels")({
    server: {
        handlers: {
            GET: () => {
                const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "tanstack-start"
                const g = globalThis as Record<string, unknown>
                return Response.json({
                    appName: APP_NAME,
                    runtime: "nodejs",
                    instrumentationAt: g[`__agenta_instr_${APP_NAME}`] ?? null,
                    firstHandlerAt: g[`__agenta_first_handler_${APP_NAME}`] ?? null,
                })
            },
        },
    },
})

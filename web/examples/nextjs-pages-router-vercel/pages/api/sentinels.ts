/**
 * Sentinel inspection endpoint — Pages Router edition.
 *
 * Same shape as the App Router app's /api/sentinels: returns the per-app
 * instrumentation + first-handler timestamps so assertion-4 can compare
 * register order.
 */

import type {NextApiRequest, NextApiResponse} from "next"

export default function handler(_req: NextApiRequest, res: NextApiResponse): void {
    const APP_NAME = process.env.AGENTA_SPIKE_APP_NAME ?? "pages-vercel"
    const g = globalThis as Record<string, unknown>
    res.status(200).json({
        appName: APP_NAME,
        runtime: process.env.NEXT_RUNTIME,
        instrumentationAt: g[`__agenta_instr_${APP_NAME}`] ?? null,
        firstHandlerAt: g[`__agenta_first_handler_${APP_NAME}`] ?? null,
    })
}

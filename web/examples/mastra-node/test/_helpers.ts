/**
 * Shared helpers for the Mastra-node assertion scripts.
 * Mirrors web/examples/node-vercel-ai-v6/test/_helpers.ts.
 */

import "dotenv/config"

export const HOST = process.env.AGENTA_HOST ?? "https://cloud.agenta.ai"
export const API_KEY = process.env.AGENTA_API_KEY
export const PROJECT_ID = process.env.AGENTA_PROJECT_ID

export function requireApiKey(name: string): string {
    if (!API_KEY) {
        console.error(`${name}: AGENTA_API_KEY required`)
        process.exit(1)
    }
    return API_KEY
}

/** Per-run unique tag — used for ag.user.id filter in spike-verify. */
export function newRunId(prefix: string): string {
    return `${prefix}-${Date.now()}`
}

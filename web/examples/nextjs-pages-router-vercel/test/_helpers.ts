/**
 * Shared helpers for the Pages Router assertion scripts. Same pattern
 * as App Router's _helpers.ts, just pointing at the Pages app's port.
 */

import "dotenv/config"

export const HOST = process.env.AGENTA_HOST ?? "https://cloud.agenta.ai"
export const API_KEY = process.env.AGENTA_API_KEY
export const PROJECT_ID = process.env.AGENTA_PROJECT_ID
export const APP_BASE = process.env.APP_BASE_URL ?? "http://localhost:3104"

export function requireApiKey(name: string): string {
    if (!API_KEY) {
        console.error(`${name}: AGENTA_API_KEY required`)
        process.exit(1)
    }
    return API_KEY
}

export function newRunId(prefix: string): string {
    return `${prefix}-${Date.now()}`
}

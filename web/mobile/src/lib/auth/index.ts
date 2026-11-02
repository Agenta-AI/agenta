/**
 * The app seam over `@agenta/auth`: configuration happens here, once, at module scope, so
 * every consumer that imports "@/lib/auth" is guaranteed a configured client. Feature code
 * imports THIS module (or @agenta/auth-ui), never the package's runtime directly.
 */
import {configureAuth, installTurnstileFetchPatch} from "@agenta/auth"

import {getApiUrl, getEnv} from "../env"

configureAuth({getEnv, getApiUrl})
// EE deployments refuse auth POSTs without a Turnstile token; the patch stamps the pending one.
// Module scope, so it wraps `window.fetch` before the SuperTokens client wraps it in turn.
installTurnstileFetchPatch()

export * from "@agenta/auth"

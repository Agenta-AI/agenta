/**
 * The app seam over `@agenta/auth`: configuration happens here, once, at module scope, so
 * every consumer that imports "@/lib/auth" is guaranteed a configured client. Feature code
 * imports THIS module (or @agenta/auth-ui), never the package's runtime directly.
 */
import {configureAuth} from "@agenta/auth"

import {getApiUrl, getEnv} from "../env"

configureAuth({getEnv, getApiUrl})

export * from "@agenta/auth"

/**
 * The app seam over `@agenta/auth`: env access and the API host differ per app, so the package
 * takes both from here. Side-effect only — importing this module is what configures it, and any
 * surface that reaches for the package's flows (the sign-in page) must import it first.
 * Re-exporting the package from here is banned in oss; import `@agenta/auth` directly for the
 * values themselves.
 */
import {configureAuth} from "@agenta/auth"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

configureAuth({getEnv, getApiUrl: getAgentaApiUrl})

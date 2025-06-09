import {TestEnvironment} from "./testTags"
import type PlaywrightConfig from "./types"

/**
 * Base URLs for different deployment environments
 * Maps environment types to their respective API endpoints
 */
export const deployments: Record<PlaywrightConfig.DeploymentType, string> = {
    [TestEnvironment.local]: process.env.AGENTA_WEB_URL || "http://localhost",
    [TestEnvironment.staging]: "https://cloud.staging.agenta.ai",
    [TestEnvironment.beta]: "https://cloud.beta.agenta.ai",
    [TestEnvironment.oss]: "https://oss.agenta.ai",
    [TestEnvironment.demo]: "https://cloud.demo.agenta.ai",
    [TestEnvironment.prod]: "https://cloud.agenta.ai",
} as const

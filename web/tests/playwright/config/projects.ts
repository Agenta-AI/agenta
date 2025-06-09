import {devices, type Project} from "@playwright/test"

import {deployments} from "./deployments"
import {TestEnvironment} from "./testTags"
import type PlaywrightConfig from "./types"

/**
 * Base configuration for all test projects
 * Uses Chrome Desktop as the default browser
 */
const baseConfig = {
    use: {
        ...devices["Desktop Chrome"],
    },
}

/**
 * Creates a project configuration for a specific environment
 * @param env - Target environment type
 * @returns Playwright project configuration
 */
const createProjectConfig = (env: PlaywrightConfig.TestEnvironmentType): Project => ({
    ...baseConfig,
    name: env,
    use: {...baseConfig.use, baseURL: deployments[env]},
})

// Generate project configurations for all environments
const baseProjects = Object.keys(TestEnvironment).map((env) =>
    createProjectConfig(env as PlaywrightConfig.TestEnvironmentType),
)

/**
 * Combined project configurations for all environments
 */
export const allProjects = [...baseProjects]

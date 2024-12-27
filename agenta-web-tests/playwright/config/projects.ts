import {devices, type Project} from "@playwright/test"
import {
    TestEnvironment,
    TestFeatureScope,
    type TestEnvironmentType,
    environmentFeatures,
} from "./testTags"
import {deployments} from "./deployments"

const baseConfig = {
    use: {
        ...devices["Desktop Chrome"],
    },
}

function createFeaturePattern(
    features: (typeof TestFeatureScope)[keyof typeof TestFeatureScope][],
): RegExp {
    const patterns = features.map((feature) => `@feature-scope:${feature}`)
    return new RegExp(patterns.join("|"))
}

function createProjectConfig(env: TestEnvironmentType): Project {
    const envConfig = environmentFeatures[env]

    return {
        ...baseConfig,
        name: env,
        use: {
            ...baseConfig.use,
            baseURL: deployments[env],
        },
        grep: createFeaturePattern(envConfig.features),
    }
}

function createCloudOnlyVariant(env: TestEnvironmentType): Project | null {
    const envConfig = environmentFeatures[env]

    if (!envConfig.isCloudVariant) return null

    return {
        ...baseConfig,
        name: `${env}-cloud-only`,
        use: {
            ...baseConfig.use,
            baseURL: deployments[env],
        },
        grep: createFeaturePattern([TestFeatureScope.CLOUD_ONLY]),
    }
}

// Generate base projects
const baseProjects = Object.keys(TestEnvironment).map((env) =>
    createProjectConfig(env as TestEnvironmentType),
)

// Generate cloud-only variants
const cloudOnlyProjects = Object.keys(TestEnvironment)
    .map((env) => createCloudOnlyVariant(env as TestEnvironmentType))
    .filter((project): project is Project => project !== null)

export const allProjects = [...baseProjects, ...cloudOnlyProjects]

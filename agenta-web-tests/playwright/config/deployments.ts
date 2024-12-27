import {TestEnvironment, type TestEnvironmentType} from "./testTags"

export const deployments: Record<TestEnvironmentType, string> = {
    [TestEnvironment.local]: "http://localhost:3000",
    [TestEnvironment["local-cloud"]]: "http://localhost:3000",
    [TestEnvironment.staging]: "https://cloud.staging.agenta.ai",
    [TestEnvironment.beta]: "https://cloud.beta.agenta.ai",
} as const

export type DeploymentType = keyof typeof deployments

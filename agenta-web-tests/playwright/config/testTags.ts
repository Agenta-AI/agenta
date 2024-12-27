export const TestScope = {
    AUTH: "auth", // Authentication flows
    APPS: "apps", // App management flows
    PLAYGROUND: "playground", // Playground flows
    DATASETS: "datasets", // Dataset flows
    EVALUATIONS: "evaluations", // Evaluation flows
} as const

export const TestCoverage = {
    SMOKE: "smoke", // Wide breadth, shallow depth
    SANITY: "sanity", // Narrow breadth, deep depth
    LIGHT: "light", // Smoke + sanity
    FULL: "full", // Wide breadth, deep depth
} as const

export const TestPath = {
    HAPPY: "happy", // Expected user flows
    GRUMPY: "grumpy", // Error states & edge cases
} as const

export const TestEnvironment = {
    local: "local", // Local OSS deployment
    "local-cloud": "local-cloud", // Local cloud deployment
    staging: "staging", // Staging environment
    beta: "beta", // Beta environment
} as const

export type TestEnvironmentType = keyof typeof TestEnvironment
export type TestEnvironmentValue = (typeof TestEnvironment)[TestEnvironmentType]

// New type to distinguish cloud-only features
export const TestFeatureScope = {
    CLOUD_ONLY: "cloud-only", // Features only available in cloud environments
    COMMON: "common", // Features available in all environments
} as const

export type TestFeatureScopeType = (typeof TestFeatureScope)[keyof typeof TestFeatureScope]

// Project configuration types
export interface ProjectFeatureConfig {
    readonly features: TestFeatureScopeType[]
    readonly isCloudVariant: boolean
}

export type EnvironmentProjectConfig = Record<TestEnvironmentType, ProjectFeatureConfig>

// Define which features are available in each environment
export const environmentFeatures: EnvironmentProjectConfig = {
    local: {
        features: [TestFeatureScope.COMMON],
        isCloudVariant: false,
    },
    "local-cloud": {
        features: [TestFeatureScope.COMMON, TestFeatureScope.CLOUD_ONLY],
        isCloudVariant: true,
    },
    staging: {
        features: [TestFeatureScope.COMMON, TestFeatureScope.CLOUD_ONLY],
        isCloudVariant: true,
    },
    beta: {
        features: [TestFeatureScope.COMMON, TestFeatureScope.CLOUD_ONLY],
        isCloudVariant: true,
    },
} as const

export type TestTag =
    | (typeof TestScope)[keyof typeof TestScope]
    | (typeof TestCoverage)[keyof typeof TestCoverage]
    | (typeof TestPath)[keyof typeof TestPath]
    | (typeof TestEnvironment)[keyof typeof TestEnvironment]

export type TestTagType = "scope" | "coverage" | "path" | "env" | "feature-scope"

export interface TagArgument {
    flag: `-${TestTagType}`
    prefix: `@${TestTagType}:`
}

export const TAG_ARGUMENTS: Record<TestTagType, TagArgument> = {
    scope: {
        flag: "-scope",
        prefix: "@scope:",
    },
    coverage: {
        flag: "-coverage",
        prefix: "@coverage:",
    },
    path: {
        flag: "-path",
        prefix: "@path:",
    },
    env: {
        flag: "-env",
        prefix: "@env:",
    },
    "feature-scope": {
        flag: "-feature-scope",
        prefix: "@feature-scope:",
    },
} as const

// Type guard for checking if a string is a valid TestTagType
export function isTestTagType(value: string): value is TestTagType {
    return value in TAG_ARGUMENTS
}

// Helper to create tag string
export function createTagString(type: TestTagType, value: string): string {
    return `${TAG_ARGUMENTS[type].prefix}${value}`
}

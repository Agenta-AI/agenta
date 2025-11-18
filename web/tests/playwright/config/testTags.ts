import type PlaywrightConfig from "./types"

/**
 * Test scope categories defining different functional areas of the application
 */
export const TestScope = {
    AUTH: "auth", // Authentication flows
    APPS: "apps", // App management flows
    PLAYGROUND: "playground", // Playground flows
    DATASETS: "datasets", // Dataset flows
    EVALUATIONS: "evaluations", // Evaluation flows
    SETTINGS: "settings", // Settings flows
    DEPLOYMENT: "deployment", // Deployment flows
    OBSERVABILITY: "observability",
} as const

/**
 * Test coverage levels defining the depth and breadth of testing
 */
export const TestCoverage = {
    SMOKE: "smoke", // Wide breadth, shallow depth
    SANITY: "sanity", // Narrow breadth, deep depth
    LIGHT: "light", // Smoke + sanity
    FULL: "full", // Wide breadth, deep depth
} as const

/**
 * Test path types defining the nature of test scenarios
 */
export const TestPath = {
    HAPPY: "happy", // Expected user flows
    GRUMPY: "grumpy", // Error states & edge cases
} as const

/**
 * Deployment environments where tests can be executed
 */
export const TestEnvironment = {
    local: "local", // Local deployment
    staging: "staging", // Staging environment
    beta: "beta", // Beta environment
    oss: "oss", // OSS environment
    demo: "demo", // Demo environment
    prod: "prod", // Production environment
} as const

/**
 * Feature availability scope for different deployment types
 */
export const TestFeatureLicenseScopeType = {
    EE: "ee", // Features only available in ee
} as const

/**
 * Permission types for different test scenarios
 */
export const TestPermissionType = {
    Owner: "owner",
    Editor: "editor",
    Viewer: "viewer",
} as const

/**
 * Entitlement types for different test scenarios
 */
export const TestEntitlementType = {
    Hobby: "hobby",
    Pro: "pro",
} as const

export const TestLensType = {
    FUNCTIONAL: "functional",
    PERFORMANCE: "performance",
    SECURITY: "security",
} as const

export const TestCaseType = {
    TYPICAL: "typical",
    EDGE: "edge",
} as const

export const TestSpeedType = {
    FAST: "fast",
    SLOW: "slow",
} as const

/**
 * Environment-specific feature configuration
 * Defines which features are available in each environment
 */
export const environmentFeatures: PlaywrightConfig.EnvironmentProjectConfig = {
    local: {},
    staging: {},
    beta: {},
    oss: {},
    demo: {},
    prod: {},
} as const

/**
 * Tag argument definitions for CLI and test decoration
 * Maps tag types to their CLI flags and test decoration prefixes
 */
export const TAG_ARGUMENTS: Record<PlaywrightConfig.TestTagType, PlaywrightConfig.TagArgument> = {
    scope: {flag: "-scope", prefix: "@scope:"},
    coverage: {flag: "-coverage", prefix: "@coverage:"},
    path: {flag: "-path", prefix: "@path:"},
    env: {flag: "-env", prefix: "@env:"},
    feature: {flag: "-feature", prefix: "@feature:"},
    entitlement: {flag: "-entitlement", prefix: "@entitlement:"},
    permission: {flag: "-permission", prefix: "@permission:"},
    lens: {flag: "-lens", prefix: "@lens:"},
    case: {flag: "-case", prefix: "@case:"},
    speed: {flag: "-speed", prefix: "@speed:"},
} as const

/**
 * Creates a formatted tag string for test decoration
 * @param type - The type of test tag
 * @param value - The tag value
 * @returns Formatted tag string (e.g., "@scope:auth")
 */
export const createTagString = (type: PlaywrightConfig.TestTagType, value: string): string =>
    `${TAG_ARGUMENTS[type].prefix}${value}`

// Re-export types from the types module for backward compatibility
export type {
    TestTagType,
    TestTag,
    TagArgument,
    TestEnvironmentType,
    ProjectFeatureConfig,
    EnvironmentProjectConfig,
} from "./types"

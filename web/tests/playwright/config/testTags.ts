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
 * Role types for different test scenarios
 */
export const TestRoleType = {
    Owner: "owner",
    Editor: "editor",
    Viewer: "viewer",
} as const

/**
 * Plan types for different test scenarios
 */
export const TestPlanType = {
    Hobby: "hobby",
    Pro: "pro",
} as const

/**
 * Cost types for test execution
 */
export const TestCostType = {
    Free: "free", // No monetary cost
    Paid: "paid", // Uses paid third-party services
} as const

export const TestLicenseType = {
    OSS: "oss",
    EE: "ee",
} as const

export const TestLensType = {
    FUNCTIONAL: "functional",
    PERFORMANCE: "performance",
    SECURITY: "security",
} as const

export const TestcaseType = {
    TYPICAL: "typical",
    EDGE: "edge",
} as const

export const TestSpeedType = {
    FAST: "fast",
    SLOW: "slow",
} as const

/**
 * Tag argument definitions for CLI and test decoration
 * Maps tag types to their CLI flags and test decoration prefixes
 */
export const TAG_ARGUMENTS: Record<PlaywrightConfig.TestTagType, PlaywrightConfig.TagArgument> = {
    scope: {flag: "-scope", prefix: "@scope:"},
    coverage: {flag: "-coverage", prefix: "@coverage:"},
    path: {flag: "-path", prefix: "@path:"},
    plan: {flag: "-plan", prefix: "@plan:"},
    role: {flag: "-role", prefix: "@role:"},
    lens: {flag: "-lens", prefix: "@lens:"},
    case: {flag: "-case", prefix: "@case:"},
    speed: {flag: "-speed", prefix: "@speed:"},
    license: {flag: "-license", prefix: "@license:"},
    cost: {flag: "-cost", prefix: "@cost:"},
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
    ProjectFeatureConfig,
} from "./types"

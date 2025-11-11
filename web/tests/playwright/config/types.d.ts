/**
 * Global configuration types for Playwright test suite
 */
declare namespace PlaywrightConfig {
    /** Test category types derived from their respective enums */
    type TestScopeType =
        (typeof import("./testTags").TestScope)[keyof typeof import("./testTags").TestScope]
    type TestCoverageType =
        (typeof import("./testTags").TestCoverage)[keyof typeof import("./testTags").TestCoverage]
    type TestPathType =
        (typeof import("./testTags").TestPath)[keyof typeof import("./testTags").TestPath]
    type TestEnvironmentType = keyof typeof import("./testTags").TestEnvironment
    type TestFeatureLicenseScopeType =
        (typeof import("./testTags").TestFeatureScope)[keyof typeof import("./testTags").TestFeatureScope]
    type TestEntitlementType =
        (typeof import("./testTags").TestEntitlementType)[keyof typeof import("./testTags").TestEntitlementType]
    type TestPermissionType =
        (typeof import("./testTags").TestPermissionType)[keyof typeof import("./testTags").TestPermissionType]
    type TestLensType =
        (typeof import("./testTags").TestLensType)[keyof typeof import("./testTags").TestLensType]
    type TestCaseType =
        (typeof import("./testTags").TestCaseType)[keyof typeof import("./testTags").TestCaseType]

    /** Test tag system configuration */
    type TestTagType =
        | "scope"
        | "coverage"
        | "path"
        | "env"
        | "feature"
        | "entitlement"
        | "permission"
        | "lens"
        | "case"
        | "speed"
    type TestTag = TestScopeType | TestCoverageType | TestPathType | TestEnvironmentType

    /** Tag argument structure for CLI and test decoration */
    interface TagArgument {
        flag: `-${TestTagType}` // CLI flag format
        prefix: `@${TestTagType}:` // Test decoration format
    }

    /** Project feature configuration for different environments */
    interface ProjectFeatureConfig {
        // readonly features: TestFeatureScopeType[] // Available features in environment
    }

    /** Environment-specific project configurations */
    type EnvironmentProjectConfig = Record<TestEnvironmentType, ProjectFeatureConfig>
    /** Deployment environment type alias */
    type DeploymentType = TestEnvironmentType
}

export = PlaywrightConfig

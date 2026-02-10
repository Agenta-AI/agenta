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
    type TestLicenseType =
        (typeof import("./testTags").TestLicenseType)[keyof typeof import("./testTags").TestLicenseType]
    type TestPlanType =
        (typeof import("./testTags").TestPlanType)[keyof typeof import("./testTags").TestPlanType]
    type TestRoleType =
        (typeof import("./testTags").TestRoleType)[keyof typeof import("./testTags").TestRoleType]
    type TestLensType =
        (typeof import("./testTags").TestLensType)[keyof typeof import("./testTags").TestLensType]
    type TestcaseType =
        (typeof import("./testTags").TestcaseType)[keyof typeof import("./testTags").TestcaseType]
    type TestSpeedType =
        (typeof import("./testTags").TestSpeedType)[keyof typeof import("./testTags").TestSpeedType]
    type TestCostType =
        (typeof import("./testTags").TestCostType)[keyof typeof import("./testTags").TestCostType]

    /** Test tag system configuration */
    type TestTagType =
        | "scope"
        | "coverage"
        | "path"
        | "license"
        | "plan"
        | "role"
        | "lens"
        | "case"
        | "speed"
        | "cost"
    type TestTag = TestScopeType | TestCoverageType | TestPathType | TestLicenseType

    /** Tag argument structure for CLI and test decoration */
    interface TagArgument {
        flag: `-${TestTagType}` // CLI flag format
        prefix: `@${TestTagType}:` // Test decoration format
    }

    /** Project feature configuration for different environments */
    interface ProjectFeatureConfig {
        // Configuration for project-specific features
    }
}

export = PlaywrightConfig

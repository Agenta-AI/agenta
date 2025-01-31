/**
 * Global configuration types for Playwright test suite
 */
declare namespace PlaywrightConfig {
  /** Test category types derived from their respective enums */
  type TestScopeType =
    typeof import("./testTags").TestScope[keyof typeof import("./testTags").TestScope];
  type TestCoverageType =
    typeof import("./testTags").TestCoverage[keyof typeof import("./testTags").TestCoverage];
  type TestPathType =
    typeof import("./testTags").TestPath[keyof typeof import("./testTags").TestPath];
  type TestEnvironmentType = keyof typeof import("./testTags").TestEnvironment;
  type TestFeatureScopeType =
    typeof import("./testTags").TestFeatureScope[keyof typeof import("./testTags").TestFeatureScope];

  /** Test tag system configuration */
  type TestTagType = "scope" | "coverage" | "path" | "env" | "feature-scope";
  type TestTag =
    | TestScopeType
    | TestCoverageType
    | TestPathType
    | TestEnvironmentType;

  /** Tag argument structure for CLI and test decoration */
  interface TagArgument {
    flag: `-${TestTagType}`; // CLI flag format
    prefix: `@${TestTagType}:`; // Test decoration format
  }

  /** Project feature configuration for different environments */
  interface ProjectFeatureConfig {
    readonly features: TestFeatureScopeType[]; // Available features in environment
    readonly isCloudVariant: boolean; // Whether environment requires cloud authentication
  }

  /** Environment-specific project configurations */
  type EnvironmentProjectConfig = Record<
    TestEnvironmentType,
    ProjectFeatureConfig
  >;
  /** Deployment environment type alias */
  type DeploymentType = TestEnvironmentType;
}

export = PlaywrightConfig;

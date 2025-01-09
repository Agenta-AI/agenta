import type PlaywrightConfig from "./types";

/**
 * Test scope categories defining different functional areas of the application
 */
export const TestScope = {
  AUTH: "auth", // Authentication flows
  APPS: "apps", // App management flows
  PLAYGROUND: "playground", // Playground flows
  DATASETS: "datasets", // Dataset flows
  EVALUATIONS: "evaluations", // Evaluation flows
} as const;

/**
 * Test coverage levels defining the depth and breadth of testing
 */
export const TestCoverage = {
  SMOKE: "smoke", // Wide breadth, shallow depth
  SANITY: "sanity", // Narrow breadth, deep depth
  LIGHT: "light", // Smoke + sanity
  FULL: "full", // Wide breadth, deep depth
} as const;

/**
 * Test path types defining the nature of test scenarios
 */
export const TestPath = {
  HAPPY: "happy", // Expected user flows
  GRUMPY: "grumpy", // Error states & edge cases
} as const;

/**
 * Deployment environments where tests can be executed
 */
export const TestEnvironment = {
  local: "local", // Local OSS deployment
  "local-cloud": "local-cloud", // Local cloud deployment
  staging: "staging", // Staging environment
  beta: "beta", // Beta environment
} as const;

/**
 * Feature availability scope for different deployment types
 */
export const TestFeatureScope = {
  CLOUD_ONLY: "cloud-only", // Features only available in cloud environments
  COMMON: "common", // Features available in all environments
} as const;

/**
 * Environment-specific feature configuration
 * Defines which features are available in each environment
 * and whether cloud authentication is required
 */
export const environmentFeatures: PlaywrightConfig.EnvironmentProjectConfig = {
  local: {
    features: [TestFeatureScope.COMMON],
    isCloudVariant: false, // No auto-auth required
  },
  "local-cloud": {
    features: [TestFeatureScope.COMMON, TestFeatureScope.CLOUD_ONLY],
    isCloudVariant: true, // Auto-auth required
  },
  staging: {
    features: [TestFeatureScope.COMMON, TestFeatureScope.CLOUD_ONLY],
    isCloudVariant: true, // Auto-auth required
  },
  beta: {
    features: [TestFeatureScope.COMMON, TestFeatureScope.CLOUD_ONLY],
    isCloudVariant: true, // Auto-auth required
  },
} as const;

/**
 * Tag argument definitions for CLI and test decoration
 * Maps tag types to their CLI flags and test decoration prefixes
 */
export const TAG_ARGUMENTS: Record<
  PlaywrightConfig.TestTagType,
  PlaywrightConfig.TagArgument
> = {
  scope: { flag: "-scope", prefix: "@scope:" },
  coverage: { flag: "-coverage", prefix: "@coverage:" },
  path: { flag: "-path", prefix: "@path:" },
  env: { flag: "-env", prefix: "@env:" },
  "feature-scope": { flag: "-feature-scope", prefix: "@feature-scope:" },
} as const;

/**
 * Creates a formatted tag string for test decoration
 * @param type - The type of test tag
 * @param value - The tag value
 * @returns Formatted tag string (e.g., "@scope:auth")
 */
export const createTagString = (
  type: PlaywrightConfig.TestTagType,
  value: string
): string => `${TAG_ARGUMENTS[type].prefix}${value}`;

// Re-export types from the types module for backward compatibility
export type {
  TestTagType,
  TestTag,
  TagArgument,
  TestEnvironmentType,
  TestFeatureScopeType,
  ProjectFeatureConfig,
  EnvironmentProjectConfig,
} from "./types";

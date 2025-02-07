import { devices, type Project } from "@playwright/test";
import {
  TestEnvironment,
  TestFeatureScope,
  environmentFeatures,
} from "./testTags";
import { deployments } from "./deployments";
import type PlaywrightConfig from "./types";

/**
 * Base configuration for all test projects
 * Uses Chrome Desktop as the default browser
 */
const baseConfig = {
  use: {
    ...devices["Desktop Chrome"],
  },
};

/**
 * Creates a RegExp pattern to match feature-scoped tests
 * @param features - Array of feature scope tags
 * @returns RegExp pattern for matching test decorators
 */
const createFeaturePattern = (
  features: PlaywrightConfig.TestFeatureScopeType[]
): RegExp =>
  new RegExp(features.map((feature) => `@feature-scope:${feature}`).join("|"));

/**
 * Creates a project configuration for a specific environment
 * @param env - Target environment type
 * @returns Playwright project configuration
 */
const createProjectConfig = (
  env: PlaywrightConfig.TestEnvironmentType
): Project => ({
  ...baseConfig,
  name: env,
  use: { ...baseConfig.use, baseURL: deployments[env] },
  grep: createFeaturePattern(environmentFeatures[env].features),
});

/**
 * Creates a cloud-only variant of a project configuration
 * @param env - Target environment type
 * @returns Project configuration or null if not cloud-variant
 */
const createCloudOnlyVariant = (
  env: PlaywrightConfig.TestEnvironmentType
): Project | null => {
  if (!environmentFeatures[env].isCloudVariant) return null;

  return {
    ...baseConfig,
    name: `${env}-cloud-only`,
    use: { ...baseConfig.use, baseURL: deployments[env] },
    grep: createFeaturePattern([TestFeatureScope.CLOUD_ONLY]),
  };
};

// Generate project configurations for all environments
const baseProjects = Object.keys(TestEnvironment).map((env) =>
  createProjectConfig(env as PlaywrightConfig.TestEnvironmentType)
);

const cloudOnlyProjects = Object.keys(TestEnvironment)
  .map((env) =>
    createCloudOnlyVariant(env as PlaywrightConfig.TestEnvironmentType)
  )
  .filter((project): project is Project => project !== null);

/**
 * Combined project configurations for all environments
 * Includes both base and cloud-only variants where applicable
 */
export const allProjects = [...baseProjects, ...cloudOnlyProjects];

import { TestEnvironment } from "./testTags";
import type PlaywrightConfig from "./types";

/**
 * Base URLs for different deployment environments
 * Maps environment types to their respective API endpoints
 */
export const deployments: Record<PlaywrightConfig.DeploymentType, string> = {
  [TestEnvironment.local]: "http://localhost:3000",
  [TestEnvironment["local-cloud"]]: "http://localhost:3000",
  [TestEnvironment.staging]: "https://cloud.staging.agenta.ai",
  [TestEnvironment.beta]: "https://cloud.beta.agenta.ai",
} as const;

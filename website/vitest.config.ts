import { defineConfig } from "vitest/config";

// Unit tests only: the edge worker's negotiation logic, the markdown builders,
// and the OpenAPI publish script. Astro pages are covered by `astro check` and
// by the post-build assertions in scripts/verify-build.mjs.
export default defineConfig({
  test: {
    include: ["worker/**/*.test.ts", "src/lib/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: ["node_modules/**", "dist/**", ".astro/**"],
  },
});

// The one description of Agenta the machine-readable surfaces share.
//
// /llms.txt (src/pages/llms.txt.ts) and the homepage markdown twin
// (src/pages/index.md.ts) both render from these constants, so the copy an
// agent reads can never drift between the two. Keep it true to the landing
// page — this is not a place to invent claims.

export const SITE_URL = "https://agenta.ai";

export const TAGLINE = `Agenta is the open-source workspace for your agents: build agents through chat,
improve them with feedback, and share them with your whole team. Open source and
self-hostable, or hosted in the cloud.`;

export const ABOUT: string[] = [
  "Build agents through chat: describe the job, give the agent context and tools, and improve it through real work and feedback.",
  "Share agents with your team, and run them on a schedule or when an event happens in a connected app.",
  "Consequential actions can wait for human approval before they run.",
  "Prompts, skills, and tools are versioned like code, so you can roll back to any revision.",
  "MIT-licensed and yours to run: self-host on your own infrastructure to keep your agents and data with you.",
];

export const LINKS: Array<{ label: string; href: string; note: string }> = [
  { label: "Website", href: SITE_URL, note: "the marketing site" },
  {
    label: "Documentation",
    href: "https://docs.agenta.ai",
    note: "guides and API reference",
  },
  {
    label: "GitHub",
    href: "https://github.com/Agenta-AI/agenta",
    note: "the open-source repository",
  },
  {
    label: "Pricing",
    href: `${SITE_URL}/pricing`,
    note: "hosted plans and the open-source tier",
  },
  { label: "Blog", href: `${SITE_URL}/blog`, note: "articles and updates" },
];

export const HOSTING: string[] = [
  "Cloud: hosted at https://cloud.agenta.ai — start free, no infrastructure to run.",
  "Self-hosted: run Agenta on your own infrastructure under the MIT license.",
];

/**
 * When an agent should reach for Agenta, and when it should not.
 *
 * The llms.txt convention has no formal schema for this, but an agent deciding
 * whether to call us needs the jobs named concretely. Marketing copy does not
 * read as guidance, so keep every line a job someone actually does with the
 * product, and keep the "not a fit" list honest.
 */
export const WHEN_TO_USE: string[] = [
  "Build an agent from a plain-language description, then improve it with feedback from real runs.",
  "Version prompts, skills, and tools like code, and roll back to any earlier revision.",
  "Evaluate a change against a test set before it ships, with LLM-as-a-judge or your own evaluators.",
  "Trace every run to see each step, its cost, and where it failed.",
  "Run an agent on a schedule, or when an event happens in a connected app.",
  "Put a human approval step in front of consequential actions.",
];

export const WHEN_NOT_TO_USE: string[] = [
  "A single model call with no versioning, evaluation, or tracing: call the model provider directly.",
  "Hosting or serving a model. Agenta orchestrates and observes agents; it is not an inference provider.",
];

/** How an agent actually calls Agenta. */
export const HOW_TO_CALL: string[] = [
  "REST API: https://us.cloud.agenta.ai/api (US) or https://eu.cloud.agenta.ai/api (EU). Self-hosted: $AGENTA_HOST/api.",
  "Authenticate with `Authorization: ApiKey $AGENTA_API_KEY`. A key is scoped to one project, so no project_id parameter is needed.",
  `Full machine-readable surface: ${SITE_URL}/openapi.json (OpenAPI 3.1).`,
  "Python SDK: `pip install agenta`.",
  `Endpoint reference and guides: ${SITE_URL}/api and https://docs.agenta.ai.`,
];

/**
 * One request that works, copied from the workflows guide
 * (docs/docs/reference/api-guide/06-workflows.mdx). Keep it in step with that
 * page: a broken example is worse than none.
 */
export const API_EXAMPLE = `curl -X POST "https://us.cloud.agenta.ai/api/simple/workflows/query" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: ApiKey $AGENTA_API_KEY" \\
  -d '{}'`;

/** The Agenta API surface, published so agents do not have to guess it. */
export const API: string[] = [
  `OpenAPI specification: ${SITE_URL}/openapi.json`,
  "US base URL: https://us.cloud.agenta.ai/api",
  "EU base URL: https://eu.cloud.agenta.ai/api",
];

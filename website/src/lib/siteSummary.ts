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

/** The Agenta API surface, published so agents do not have to guess it. */
export const API: string[] = [
  `OpenAPI specification: ${SITE_URL}/openapi.json`,
  "US base URL: https://us.cloud.agenta.ai/api",
  "EU base URL: https://eu.cloud.agenta.ai/api",
];

export const MACHINE_READABLE: Array<{ label: string; href: string }> = [
  { label: "Sitemap", href: `${SITE_URL}/sitemap-index.xml` },
  { label: "llms.txt", href: `${SITE_URL}/llms.txt` },
  { label: "OpenAPI specification", href: `${SITE_URL}/openapi.json` },
  { label: "Documentation", href: "https://docs.agenta.ai" },
];

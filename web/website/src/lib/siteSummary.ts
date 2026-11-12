// The one description of Agenta the machine-readable surfaces share.
//
// /llms.txt (src/pages/llms.txt.ts) and the homepage markdown twin
// (src/pages/index.md.ts) both render from these constants, so the copy an
// agent reads can never drift between the two. Keep it true to the landing
// page (src/components/landing/*): same positioning, same section names, same
// product words. This is not a place to invent claims.

export const SITE_URL = "https://agenta.ai";

/** The positioning line. Matches the landing H1, page title and footer. */
export const POSITIONING = "The open-source agent platform";

export const TAGLINE = `Agenta is the open-source agent platform. Build agents and automations by
chatting with them, work with them in the Agenta workspace, or deploy them to
Slack, Microsoft Teams, Discord, WhatsApp, Telegram or your website, for your
team and your clients. Self-hosted or in the cloud.`;

export const ABOUT: string[] = [
  "Do the work in chat, then automate it: ask an agent for a job in plain words, watch it work with your apps and files, and put it on a schedule with one more message.",
  "Work with your agents in a shared workspace: run several sessions side by side, share conversations and files, and work with the same agent together.",
  "Deploy where people already are: publish an agent to Slack, Microsoft Teams, Discord, WhatsApp or Telegram, or embed it as a chat widget on a website.",
  "Start from a template: ready-made agents for engineering, sales, marketing, support, knowledge and operations work, which you connect to your apps and change.",
  "Everything an agent needs: any model or your own ChatGPT or Claude subscription, 1,000+ integrations, an MCP gateway, a browser and files for each agent, schedules and triggers, a secret vault, and instructions that improve when you correct the agent.",
  "Stay in control: approvals before consequential actions, private or shared access per agent, and analytics per agent for runs and spend.",
  "Open source (MIT) and self-hostable on your own infrastructure, or hosted at cloud.agenta.ai.",
];

/**
 * Capabilities, one line each, named with the words the product and the
 * landing page use, so an agent searching for a feature finds it here.
 */
export const CAPABILITIES: string[] = [
  "Chat-built agents: describe the job in chat, and Agenta builds the agent: its instructions (AGENTS.md), skills, tools and connected apps.",
  "Automations: run an agent on a schedule (cron) or when a trigger happens in a connected app, for example a new Zendesk ticket or a Slack mention. Every run is logged.",
  "Channels: Slack, Microsoft Teams, Discord, WhatsApp, Telegram, and a website chat widget (embed).",
  "Shared workspace: sessions, shared conversations, agent files (drive), and several people working with one agent.",
  "Models: use the ChatGPT or Claude plan you already pay for, any API key (OpenAI, Anthropic, Google Gemini, xAI, OpenRouter), or self-hosted models through Ollama. Pick the model per agent.",
  "Integrations: 1,000+ apps (Slack, Notion, GitHub, HubSpot, Google Drive, Linear, Zendesk and more) and MCP servers through the MCP gateway, shared with the team or connected for one person.",
  "Agent computer: each agent gets its own browser for research and its own files.",
  "Secret vault: store credentials once; tools use them and the values never show in chats or logs.",
  "Agents that learn: when you correct an agent in chat it updates its instructions, and every change is a new version you can roll back.",
  "Approvals: choose which actions run on their own and which wait for a person.",
  "Access: keep an agent private or share it with your team.",
  "Analytics: runs, success rate and spend per agent.",
  "Templates: a catalog of ready-made agents, browsable at https://agenta.ai/marketplace.",
  "Self-hosting: MIT license, Docker Compose, Kubernetes (beta).",
];

/** Product words, so a search for one finds the others. */
export const GLOSSARY: string[] = [
  "Agent: an AI worker defined by instructions, a model, tools, skills and connected apps.",
  "Automation: an agent run that starts on a schedule or from a trigger, without a person in chat.",
  "Trigger: an event in a connected app that runs an agent.",
  "Template: a ready-made agent you copy into your workspace and change.",
  "Channel: where people talk to a deployed agent (Slack, Teams, Discord, WhatsApp, Telegram, website widget).",
  "Session: one conversation with an agent; sessions can be shared.",
  "Revision: a saved version of an agent; you can roll back to any revision.",
];

export const LINKS: Array<{ label: string; href: string; note: string }> = [
  { label: "Website", href: SITE_URL, note: "the marketing site" },
  {
    label: "Documentation",
    href: "https://docs.agenta.ai",
    note: "guides and API reference",
  },
  {
    label: "Templates",
    href: `${SITE_URL}/marketplace`,
    note: "the template catalog, filterable by category and app",
  },
  {
    label: "Self-hosting",
    href: "https://docs.agenta.ai/self-host/quick-start",
    note: "run Agenta on your own infrastructure",
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
  "Self-hosted: run Agenta on your own infrastructure under the MIT license (Docker Compose, or Kubernetes in beta).",
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
  "Build an agent from a plain-language description, then improve it by correcting it in chat.",
  "Turn a job someone repeats every week into an automation that runs on a schedule or when an event happens in a connected app.",
  "Give a team, or a client, an agent they reach in Slack, Teams, Discord, WhatsApp, Telegram or on a website.",
  "Start from a template for a common job (PR review, lead qualification, support replies, SEO content and more) and adapt it.",
  "Put a human approval step in front of consequential actions, such as sending an email.",
  "Version an agent's instructions, skills and tools, and roll back to any earlier revision.",
  "Inspect each run's steps, cost and errors, and compare versions in the playground.",
];

export const WHEN_NOT_TO_USE: string[] = [
  "A single model call with no tools, automation or versioning: call the model provider directly.",
  "Hosting or serving a model. Agenta builds, runs and observes agents; it is not an inference provider.",
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

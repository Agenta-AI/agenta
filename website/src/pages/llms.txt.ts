// Dynamic llms.txt — served at /llms.txt, mirroring src/pages/robots.txt.ts.
//
// Follows the llms.txt convention (https://llmstxt.org): a short, factual map of
// the site for LLMs and AI crawlers, which we allow (see robots.txt.ts). Copy is
// pulled from the landing page, not invented — keep it true to the actual site.
import type { APIRoute } from "astro";

const body = `# Agenta

> Agenta is the open-source workspace for your agents: build agents through chat,
> improve them with feedback, and share them with your whole team. Open source and
> self-hostable, or hosted in the cloud.

## About

- Build agents through chat: describe the job, give the agent context and tools, and improve it through real work and feedback.
- Share agents with your team, and run them on a schedule or when an event happens in a connected app.
- Consequential actions can wait for human approval before they run.
- Prompts, skills, and tools are versioned like code, so you can roll back to any revision.
- MIT-licensed and yours to run: self-host on your own infrastructure to keep your agents and data with you.

## Links

- [Website](https://agenta.ai): the marketing site.
- [Documentation](https://docs.agenta.ai): guides and API reference.
- [GitHub](https://github.com/Agenta-AI/agenta): the open-source repository.
- [Pricing](https://agenta.ai/pricing): hosted plans and the open-source tier.
- [Blog](https://agenta.ai/blog): articles and updates.

## Hosting

- Cloud: hosted at https://cloud.agenta.ai — start free, no infrastructure to run.
- Self-hosted: run Agenta on your own infrastructure under the MIT license.
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

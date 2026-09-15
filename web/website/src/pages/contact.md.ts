// Markdown twin of /contact. The page is short and hand-built, so the body is
// written here — keep it in step with src/pages/contact.astro.
import type { APIRoute } from "astro";
import { markdownResponse, page } from "../lib/markdown";

const body = `## Book a demo

30 minutes. We'll show you how Agenta fits your LLM workflow and answer any
questions you have.

- [Book a 30-minute demo](https://cal.com/mahmoud-mabrouk-ogzgey/demo?duration=30)
- [Get started free](https://cloud.agenta.ai/)

## Direct contact

- Email: team@agenta.ai
- Phone: +49-(0)-152-31036519
- Address: Agentatech UG (haftungsbeschränkt), c/o betahaus, Rudi-Dutschke-Straße 23, 10969 Berlin, Germany

## Community

- [GitHub](https://github.com/Agenta-AI/agenta)
- [Slack](https://join.slack.com/t/agenta-hq/shared_invite/zt-1zsafop5i-Y7~ZySbhRZvKVPV5DO_7IA)
- [LinkedIn](https://www.linkedin.com/company/agenta-ai/)
`;

export const GET: APIRoute = () =>
  markdownResponse(
    page({
      title: "Contact Agenta",
      description:
        "Get in touch with the Agenta team. Book a 30-minute demo, email us, or join the community on GitHub, Slack, and LinkedIn.",
      path: "/contact",
      body,
    }),
  );

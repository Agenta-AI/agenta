// Markdown twin of /api — the same signpost, in the shape an agent reads.
import type { APIRoute } from "astro";
import { markdownResponse, page } from "../lib/markdown";
import {
  API_EXAMPLE,
  HOW_TO_CALL,
  WHEN_NOT_TO_USE,
  WHEN_TO_USE,
} from "../lib/siteSummary";

const body = `## When to use Agenta

${WHEN_TO_USE.map((item) => `- ${item}`).join("\n")}

## When not to use Agenta

${WHEN_NOT_TO_USE.map((item) => `- ${item}`).join("\n")}

## How to call it

${HOW_TO_CALL.map((item) => `- ${item}`).join("\n")}

## Example request

\`\`\`bash
${API_EXAMPLE}
\`\`\`

An API key is scoped to a single project, so endpoints take no \`project_id\`.
Create one in your project settings on https://cloud.agenta.ai/.
`;

export const GET: APIRoute = () =>
  markdownResponse(
    page({
      title: "Agenta API",
      description:
        "The Agenta REST API: base URLs, authentication, an example request, and the OpenAPI specification.",
      path: "/api",
      body,
    }),
  );

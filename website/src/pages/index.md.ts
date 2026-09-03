// Markdown twin of the landing page — /index.md, and what the worker serves
// for `GET / ` with `Accept: text/markdown`.
//
// Copy comes from src/lib/siteSummary.ts, the same source as /llms.txt.
import type { APIRoute } from "astro";
import { markdownResponse, page } from "../lib/markdown";
import {
  ABOUT,
  API,
  HOSTING,
  HOW_TO_CALL,
  LINKS,
  TAGLINE,
  WHEN_NOT_TO_USE,
  WHEN_TO_USE,
} from "../lib/siteSummary";

const body = `## What Agenta is

${TAGLINE.replace(/\n/g, " ")}

## What you can do

${ABOUT.map((item) => `- ${item}`).join("\n")}

## When to use Agenta

${WHEN_TO_USE.map((item) => `- ${item}`).join("\n")}

## When not to use Agenta

${WHEN_NOT_TO_USE.map((item) => `- ${item}`).join("\n")}

## How to call Agenta

${HOW_TO_CALL.map((item) => `- ${item}`).join("\n")}

## Hosting

${HOSTING.map((item) => `- ${item}`).join("\n")}

## API

${API.map((item) => `- ${item}`).join("\n")}

## Links

${LINKS.map((link) => `- [${link.label}](${link.href}): ${link.note}.`).join("\n")}
`;

export const GET: APIRoute = () =>
  markdownResponse(
    page({
      title: "Agenta — The open-source workspace for your agents",
      description:
        "Agenta is the open-source workspace for your agents. Build agents through chat, improve them with feedback, and share them with your whole team — self-hosted or in the cloud.",
      path: "/",
      body,
    }),
  );

// Markdown twin of /pricing, rendered from the same src/data/pricing.json that
// drives the HTML page — so the plans an agent reads are the plans on screen.
import type { APIRoute } from "astro";
import { markdownResponse, page } from "../lib/markdown";
import pricing from "../data/pricing.json";

type Plan = {
  name: string;
  tagline: string;
  price: string;
  unit: string;
  includesLabel: string;
  features: string[];
  cta: { label: string; href: string };
};

const mode = (label: string, plans: Plan[]) => `### ${label}

${plans
  .map(
    (plan) => `#### ${plan.name} — ${plan.price} ${plan.unit}

${plan.tagline}

${plan.includesLabel}:

${plan.features.map((feature) => `- ${feature}`).join("\n")}

[${plan.cta.label}](${plan.cta.href})`,
  )
  .join("\n\n")}`;

const modes = pricing.hostingToggle.options
  .map((option) =>
    mode(
      `${option.label} ${option.sublabel}`,
      pricing.plansByMode[option.mode as keyof typeof pricing.plansByMode] as Plan[],
    ),
  )
  .join("\n\n");

const faqs = pricing.faqs
  .map((faq) => `### ${faq.question}\n\n${faq.answer}`)
  .join("\n\n");

const body = `${pricing.hero.description}

## Plans

${modes}

## Frequently asked questions

${faqs}
`;

export const GET: APIRoute = () =>
  markdownResponse(
    page({
      title: pricing.hero.headline,
      description: pricing.hero.description,
      path: "/pricing",
      body,
    }),
  );

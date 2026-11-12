// Template keys the landing page and the nav menu link to. Every key must exist
// in the template catalog (src/data/templates.json); templates.test.ts checks it.

// Nav "Templates" menu: one column per catalog category, three picks each.
export const NAV_TEMPLATE_PICKS: { category: string; label: string; keys: string[] }[] = [
  { category: "Engineering", label: "Engineering", keys: ["pr-reviewer", "incident-responder", "error-triage"] },
  { category: "Sales", label: "Sales", keys: ["lead-qualifier", "meeting-followup", "pipeline-digest"] },
  { category: "Marketing", label: "Marketing", keys: ["seo-content-agent"] },
  { category: "Support", label: "Support", keys: ["support-triage", "support-reply-drafter", "bug-report-router"] },
  { category: "Knowledge", label: "Knowledge", keys: ["docs-qa", "knowledge-chatbot", "onboarding-buddy"] },
  { category: "Ops", label: "Operations", keys: ["standup-summarizer", "weekly-report", "cross-tool-sync"] },
];

// Landing "Start from an agent that already works" cards, in display order.
export const SHOWCASE_KEYS = ["meeting-followup", "lead-qualifier", "support-reply-drafter", "seo-content-agent"] as const;

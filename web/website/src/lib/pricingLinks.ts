// Turns known text tokens (defined in src/data/pricing.json `links`) into links,
// so the visible strings in the data file stay the single source of truth and no
// link text is hardcoded in the components. `linkify` splits a string into an
// ordered list of parts; a part with an `href` renders as an anchor, the rest as
// plain text. Used for plan features, comparison labels/cells, and FAQ answers.

export interface PricingLink {
  text: string;
  href: string;
}

export interface LinkPart {
  text: string;
  href?: string;
}

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function linkify(input: string, links: PricingLink[]): LinkPart[] {
  if (!links.length || !input) return [{ text: input }];

  // Longest tokens first so overlapping tokens match the most specific one.
  const sorted = [...links].sort((a, b) => b.text.length - a.text.length);
  const pattern = new RegExp(
    `(${sorted.map((l) => escapeRegExp(l.text)).join("|")})`,
    "g",
  );

  const parts: LinkPart[] = [];
  let lastIndex = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: input.slice(lastIndex, index) });
    const matched = match[0];
    const link = sorted.find((l) => l.text === matched);
    parts.push({ text: matched, href: link?.href });
    lastIndex = index + matched.length;
  }
  if (lastIndex < input.length) parts.push({ text: input.slice(lastIndex) });
  return parts;
}

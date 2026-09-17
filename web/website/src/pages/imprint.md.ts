// Markdown twin of /imprint. Legal text — keep it identical to
// src/pages/imprint.astro; do not paraphrase.
import type { APIRoute } from "astro";
import { markdownResponse, page } from "../lib/markdown";

const body = `Information in accordance with § 5 DDG (Digitale-Dienste-Gesetz). This page
also serves as the contact page for Agenta.

## Legal notice

- Company: Agentatech UG (haftungsbeschränkt)
- Address: c/o betahaus, Rudi-Dutschke-Straße 23, 10969 Berlin, Germany
- Represented by: Managing director (Geschäftsführer): Mahmoud Mabrouk
- Commercial register: Amtsgericht Charlottenburg (Berlin), HRB 254081 B
- VAT ID: USt-IdNr. in accordance with § 27a UStG: DE363150015
- Responsible for content: Mahmoud Mabrouk (address as above), § 18 Abs. 2 MStV

## Contact

- Phone: +49-(0)-152-31036519
- Email: team@agenta.ai
- Website: https://agenta.ai
`;

export const GET: APIRoute = () =>
  markdownResponse(
    page({
      title: "Imprint",
      description:
        "Legal imprint for Agentatech UG (haftungsbeschränkt), Berlin. Required by § 5 DDG.",
      path: "/imprint",
      body,
    }),
  );

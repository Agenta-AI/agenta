# Page: Privacy Policy (/privacy-policy)

**URL:** https://agenta.ai/privacy-policy  
**Category:** Legal/utility  
**Design covered:** NO — needs design (build-basic-dark)  

---

## Purpose
Privacy Policy for the Agenta platform.

## Redirect behaviour
`/privacy-policy` returns HTTP 308 (Permanent Redirect) to:
`https://app.termly.io/document/privacy-policy/ce8134b1-80c5-44b7-b3b2-01dba9765e59`

The termly.io policy viewer is entirely JavaScript-rendered. Automated scrapers (including Jina Reader) return only the page shell with no policy text.

## Footer links
The footer has two privacy policy links:
1. "Privacy Policy" → docs.agenta.ai/administration/security/privacy-policy
2. A second "Privacy Policy" link → app.termly.io directly (the termly document URL)

So there are three different pointers to privacy policy content across the site.

## Action required for new build
- Decide: keep redirect → termly.io, OR host the text directly.
- If hosted directly: fetch the full text from Termly dashboard (document UUID: `ce8134b1-80c5-44b7-b3b2-01dba9765e59`) and render as a long-form dark page.
- If keeping redirect: a `/privacy-policy` route still needs to exist.
- Consolidate the duplicate footer links.

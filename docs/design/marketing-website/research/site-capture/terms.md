# Page: Terms of Service (/terms)

**URL:** https://agenta.ai/terms  
**Category:** Legal/utility  
**Design covered:** NO — needs design (build-basic-dark)  

---

## Purpose
Terms of Service / Terms of Use for the Agenta platform.

## Redirect behaviour
`/terms` returns HTTP 308 (Permanent Redirect) to:
`https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7`

The termly.io policy viewer is entirely JavaScript-rendered. Automated scrapers (including Jina Reader) return only the page shell with no policy text.

## Footer links
The footer links "Terms of services" to **docs.agenta.ai/administration/security/terms-of-service** (on the docs subdomain), not to `/terms`. So the site has two parallel pointers for terms — the `/terms` redirect (termly) and the docs page.

## Action required for new build
- Decide: keep redirect → termly.io, OR host the text directly as a page.
- If hosted directly: capture the full text from the Termly dashboard (or ask legal for the document) and render as a long-form dark page.
- If keeping redirect: note that a `/terms` route still needs to exist (308 → termly, or embed the termly widget in an iframe).
- Policy UUID: `506861af-ea3d-41d2-b85a-561e15b0c7b7`

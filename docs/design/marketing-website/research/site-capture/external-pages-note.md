# External Pages Note

These are pages linked from agenta.ai but hosted on other subdomains or third-party services. They are OUT OF SCOPE for the agenta.ai marketing site build but must be accounted for in the footer and nav.

---

## status.agenta.ai
**URL:** https://status.agenta.ai/  
**What it is:** Service status page (uptime/incidents). Hosted on Vercel, appears to be a third-party status service.  
**Footer link:** "Status" in the Resources section  
**Build note:** Keep as an external link. No page to build.

## trustcenter.agenta.ai
**URL:** https://trustcenter.agenta.ai/  
**What it is:** Security and compliance trust center (powered by Sprinto). Shows SOC 2 compliance, controls, resources. Has sub-pages: /compliance, /controls, /resources.  
**Footer:** SOC2 badge in footer links here.  
**Build note:** Keep as an external link. The SOC2 badge in the footer should link to this subdomain.

## cloud.agenta.ai
**URL:** https://cloud.agenta.ai/  
**What it is:** The main product app (the SaaS platform). CTA buttons "Get started" and "Start building" point here.  
**Build note:** Keep as external CTA link.

## docs.agenta.ai
**URL:** https://docs.agenta.ai/  
**What it is:** Documentation site (Docusaurus). Out of scope for marketing site.  
**Footer/nav links:** "Docs", "Tutorial", "Changelog", "Roadmap" all point here.  
**Build note:** Keep as external links. Also note the legal pages (Terms, Privacy, DPA) in the footer link to docs.agenta.ai paths — these may need to be moved to agenta.ai proper in the new build.

## app.termly.io
**URLs:**
- Privacy Policy: https://app.termly.io/document/privacy-policy/ce8134b1-80c5-44b7-b3b2-01dba9765e59
- Terms of Service: https://app.termly.io/policy-viewer/policy.html?policyUUID=506861af-ea3d-41d2-b85a-561e15b0c7b7

**What it is:** Third-party policy hosting service. Agenta's `/privacy-policy` and `/terms` routes redirect (308) here.  
**Build note:** Decide whether to self-host these documents or keep the redirects.

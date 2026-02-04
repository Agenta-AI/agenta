# Status: Data Region Selector

> **Last Updated:** 2026-02-04
> **Phase:** Planning Complete - Awaiting Design
> **Next Step:** Designer creates Figma mockups, then implementation

---

## Current State

Planning and research phase complete. Design issue created for designer.

### Completed
- [x] Codebase research - auth flow understanding
- [x] Langfuse reference implementation analysis
- [x] UX design with wireframes (updated based on feedback)
- [x] Technical approach documented
- [x] Execution plan created
- [x] Design issue description created (`design-issue.md`)

### Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Region detection | `NEXT_PUBLIC_AGENTA_CLOUD_REGION` env var | Follows Langfuse pattern, clean separation |
| Default region | EU | Existing users are there, GDPR compliance |
| UI pattern | Two button-style selectors + info modal | Matches social auth buttons; clear selected state |
| Region switch | Direct redirect, no confirmation | Less friction; education via Learn more modal |
| Cloud alias behavior | Keep `cloud.agenta.ai` as EU alias | Do not force redirects between `cloud` and `eu` |

### Open Questions

1. **Auth callbacks** - Is `NEXT_PUBLIC_AGENTA_WEB_URL` set to `https://cloud.agenta.ai` for EU (alias) and `https://us.cloud.agenta.ai` for US?
2. **Analytics** - Do we want to track region switching via PostHog?

---

## Progress Log

### 2026-02-04 (Update 2)

- Analyzed Langfuse's `AuthCloudRegionSwitch.tsx` implementation
- Updated UX design based on feedback:
  - Changed from dropdown to two button-style selectors
  - Removed confirmation modal; added Learn more info modal
- Added `NEXT_PUBLIC_AGENTA_CLOUD_REGION` env var proposal
- Created `design-issue.md` for designer handoff

### 2026-02-04 (Initial)

- Created planning workspace
- Analyzed current auth implementation
- Documented industry patterns
- Created initial wireframes
- Estimated 5-7 days of work

---

## Blockers

None currently. Waiting for:
- Designer to create Figma mockups
- Confirmation of the EU/US callback host configuration

---

## Next Actions

1. [x] Create design issue for designer
2. [ ] Designer creates Figma mockups
3. [ ] Confirm `NEXT_PUBLIC_AGENTA_WEB_URL` per region deployment
4. [ ] Begin Phase 1 implementation (after design approval)

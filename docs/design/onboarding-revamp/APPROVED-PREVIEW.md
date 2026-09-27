# Approved onboarding preview, 2026-09-15

Design reference: https://agenta-onboarding-design-20260915.mahmoud-637.workers.dev/?v=3

The reference is the supplied `Onboarding Prototype (interactive).html`, from `Agenta onboarding extraction (2).zip`. The application follows its five-step layout and the two first-agent treatments, using real model and tool connections.

- Full-page shell, Agenta wordmark, full-width progress, centered role/referral cards with Phosphor icons, and borderless navigation.
- Tools load on scroll with a bottom fade. Intermediate pages display complete three-column rows; the last page may have a partial row. Connected tools sort first. The connection dialog uses its generated name in onboarding.
- Model setup presents available connections, ChatGPT, Claude's self-hosting information, and provider keys. Credit amounts are not invented from prototype copy. Creation still requires a runnable selected model.
- Name-first uses the identity selector and horizontal suggestions. A name alone creates a builder seed. Task-first presents tasks and an illustrative example alongside them. Both use the existing save and first-message path.
- Icon choices use the existing client-side agent-icon storage and transfer from the temporary agent to the saved artifact; they do not synchronize between browsers.

The original reference's OAuth, balance and agent runs are simulations. The implementation preserves live validation, permission selection, model connection dialogs, errors and retries.

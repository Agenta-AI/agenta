# Approved onboarding preview, 2026-09-15

Design reference: https://agenta-onboarding-design-20260915.mahmoud-637.workers.dev/?v=3

The reference is the supplied `Onboarding Prototype (interactive).html`, from `Agenta onboarding extraction (2).zip`. The mobile app (`web/mobile/src/features/onboarding/`) follows its five-step layout (role, tools, model, referral, first agent) and the two first-agent treatments, using real model and tool connections.

- Full-page shell, Agenta wordmark, full-width progress, centered role/referral cards with Phosphor icons, and borderless navigation.
- Tools load on scroll with a bottom fade. Intermediate pages display complete rows; the last page may have a partial row. A tool keeps its catalog position when it connects, so cards do not move under the pointer. A card starts the provider sign-in directly, under a generated connection name. Composio Search and Browser Tool need no sign-in, so they are connected once per project and browser session when the step first loads, never in a preview.
- Model setup presents available connections, ChatGPT, Claude's self-hosting information, and provider keys. Credit amounts are not invented from prototype copy. Creation still requires a runnable selected model.
- Name-first uses the identity selector and horizontal suggestions. A name alone creates a builder seed. Task-first presents tasks and an illustrative example alongside them. Both use the existing save and first-message path.
- Icon choices stay in the onboarding draft until Create, then save onto the new agent's workflow artifact (`tags["@ag"].icon`), so every browser and teammate sees them. Name-first saves the identity it shows, including the default one.

The original reference's OAuth, balance and agent runs are simulations. The implementation preserves live validation, permission selection, model connection dialogs, errors and retries.

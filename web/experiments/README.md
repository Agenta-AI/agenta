# First-agent onboarding

The first-agent onboarding flow no longer runs a PostHog experiment. The `onboarding-first-agent-v1` A/B test (name first against task first) was dropped, and its setup file was removed. Every visitor gets the same flow. If the flag still exists in PostHog, archive it there; nothing in the app reads it.

The flow lives in the mobile app (`web/mobile/src/features/onboarding/`, served at `/m`) on its own page, `/m/w/<workspace>/p/<project>/onboarding`. Each step is a path under it (`/source`, `/credits`, `/templates`, `/templates/<template key>`, `/templates/scratch`, `/review`), so the browser's Back and Forward walk the steps.

The automatic trigger is off by default. Set `NEXT_PUBLIC_AGENTA_ONBOARDING_FLOW_ENABLED=true` to turn it on. A container takes it from `AGENTA_ONBOARDING_FLOW_ENABLED` through `web/entrypoint.sh`, and a host-run app reads it from `web/mobile/public/__env.js` or the build environment.

With the flag on, onboarding is per user. When SuperTokens reports a new user at sign-up, the app saves `agenta:onboarding:pending:<user id>` in local storage. While that mark stands, Home (`/m/w/<workspace>/p/<project>/apps`) sends the user to `/onboarding` in the same project. If that project already has agents, as for an invited teammate, the app clears the mark and stays on Home. Create or "Skip for now" clears the mark. With the flag off, or without a mark, an empty project opens Home as before. The flow has four numbered steps:

1. What kind of work do you do? Twelve answers, picked by tap or by the letter keys A to L. The flow moves on by itself.
2. How did you hear about Agenta? The same twelve-answer pattern.
3. How your agents run. The Agenta credits row shows the organization's real credits: the `starter-credits` Vault connection, Agenta's built-in models, and the wallet balance when the wallet is enforced. No number appears unless the wallet reports one. ChatGPT opens the existing subscription sign-in dialog, and the API key row opens the existing provider drawer. The model is picked automatically from the runnable connections, with Agenta credits first. If nothing can run, the step says so.
4. Create your first agent. A gallery of the real template catalog, grouped by category, with Recommended ordered by the first answer. A template fills the creator, and Start from scratch opens it blank. The creator takes a name, an icon and color, instructions, optional apps, and a first message. Create commits the agent with those instructions and opens its playground with the first message sent.

To preview the flow on any project, open `/m/w/<workspace>/p/<project>/onboarding`. Without a pending mark the page is a preview: it sends no analytics. Create still creates a real agent. To test the trigger by hand, set `agenta:onboarding:pending:<your user id>` in local storage and open Home in an empty project.

Outside a preview, the flow sends these events:

- `onboarding_started` when the flow opens.
- `onboarding_step_completed` each time the user moves forward. It carries `step` (the 1-based position in the order `role`, `source`, `credits`, `templates`, `review`) and `step_key`. It sets the `user_role_v2` and `referral_source_v2` person properties once each answer is given. The answer lists changed with this flow, so values recorded before it use the old labels.
- `onboarding_create_clicked` when Create is pressed.
- `onboarding_agent_created` after the agent is saved, with its `revision_id`. It does not claim the first run succeeded.
- `onboarding_skipped` when the user presses "Skip for now", with the same `step` and `step_key`.

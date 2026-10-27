# First-agent onboarding

The first-agent onboarding flow no longer runs a PostHog experiment. The `onboarding-first-agent-v1` A/B test (name first against task first) was dropped, and its setup file was removed. Every visitor gets the same flow. If the flag still exists in PostHog, archive it there; nothing in the app reads it.

The flow lives in the mobile app (`web/mobile/src/features/onboarding/`, served at `/m`) on its own page, `/m/w/<workspace>/p/<project>/onboarding`. Each step is a path under it (`/persona`, `/size`, `/source`, `/credits`, `/templates`, `/templates/<template key>`, `/templates/scratch`), so the browser's Back and Forward walk the steps.

No environment flag gates onboarding. Onboarding is per user. When SuperTokens reports a new user at sign-up, the app saves `agenta:onboarding:pending:<user id>` in local storage. While that mark stands, Home (`/m/w/<workspace>/p/<project>/apps`) sends the user to `/onboarding` in the same project. If that project already has agents, as for an invited teammate, the app clears the mark and stays on Home. Create or Skip clears the mark. Without a mark, an empty project opens Home as before. The flow has five numbered steps:

1. What best describes you? The user's role (Founder or Executive, Freelancer / Consultant / Agency, Engineer (AI, SWE, ML), Product Manager, Sales, Marketing, Support, IT / Operations, Student, Hobbyist, Other), picked by tap or by the letter keys; it orders Recommended in the gallery. Other asks for one line first. The flow moves on by itself.
2. How big is the company you work in? Solo, 2-10, 11-50, 51-200, 201+. It moves on by itself.
3. How did you hear about Agenta? Same pattern, with the same Other write-in.
4. How your agents run. The Agenta credits row shows the organization's real credits: the `starter-credits` Vault connection, Agenta's built-in models, and the wallet balance when the wallet is enforced. No number appears unless the wallet reports one. ChatGPT and Claude open their subscription sign-in dialogs, and the API key row opens the existing provider drawer. The model is picked automatically from the runnable connections, with Agenta credits first. If nothing can run, the step says so.
5. Create your first agent. A gallery of the real template catalog, grouped by category, with Recommended ordered by the persona answer. A template's "Use template" creates the agent from the template package and opens its playground. Start from scratch opens a blank creator that takes a name, an icon and color, and a first message; sending the message creates the agent and opens its playground with the message sent.

To preview the flow on any project, open `/m/w/<workspace>/p/<project>/onboarding`. Without a pending mark the page is a preview: it sends no analytics and does not seed the zero-auth tools. Create still creates a real agent. To test the trigger by hand, set `agenta:onboarding:pending:<your user id>` in local storage and open Home in an empty project.

Outside a preview, the flow sends these events:

- `onboarding_started` when the flow opens.
- `onboarding_step_completed` each time the user moves forward. It carries `step` (the 1-based position in the order `persona`, `source`, `credits`, `templates`) and `step_key`. It sets the `user_persona_v1` and `referral_source_v2` person properties once each answer is given; `user_role_v2` is no longer set. The answer lists changed with this flow, so values recorded before it use the old labels.
- `onboarding_create_clicked` when the user creates the agent (Use template, or sending the blank start's message).
- `onboarding_agent_created` after the agent is saved, with its `revision_id`. It does not claim the first run succeeded.

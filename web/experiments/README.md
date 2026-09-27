# First-agent onboarding experiment

`onboarding-first-agent-v1.json` records the intended PostHog configuration. It is a setup specification, not an API request body. Creating the GitHub PR does not create or launch the experiment in PostHog.

Create a web experiment with flag key `onboarding-first-agent-v1`. Use `control` (name first) and `task-first` (task first), each at 50%, with 100% overall rollout. Use the funnel from `onboarding_started` to `onboarding_agent_created` as the primary metric. The latter event fires after a successful save, not when Create is clicked. It does not claim the first agent run succeeded.

The flag is read only in first-agent onboarding. The existing analytics client identifies the visitor before flag evaluation. A resolved variant remains fixed for that mounted flow. If analytics is unavailable for three seconds, name-first onboarding remains usable without enrolling that visitor in the experiment. Such visitors do not emit the experiment's creation or start events.

For QA, use PostHog's flag override for each variant before entering an empty project. Do not add a public query-string switch to production. Without a configured PostHog client, the fallback is name first.

The shared flow replaces the post-signup survey and the empty project's playground onboarding. Role and referral choices are sent through `onboarding_step_completed` with the existing `user_role_v2` and `referral_source_v2` person properties. It no longer submits the old multi-question survey or calculates its ICP score.

Tool connections use the existing catalog and connection dialog. Only valid, active saved connections show Connected. Model selection uses the deployment's runnable candidates. Available credits and subscriptions are shown only when the backend reports them. Create commits the temporary agent, stores its first-message seed with `autoSend: true`, and opens the real playground. No template example is presented as a real run.

Sources: [PostHog experiment setup](https://posthog.com/docs/experiments/creating-an-experiment), [experiment API](https://posthog.com/docs/api/experiments).

# User requirements

Source: Mahmoud's requirements and scope clarification in the PR #6622 discussion with the AI
agent on September 8, 2026. The text below is edited for clarity only. Technical interpretations
are recorded separately in [technical inferences](technical-inferences.md).

## Required behavior

1. The user can sign in to their ChatGPT account from the Agenta UI.
2. After signing in, the user sees their ChatGPT subscription as an option in the model list,
   just as they do today when using subscriptions through mounts.
3. The user can use the subscription with as many sessions and agents as they like, including
   sessions running in parallel.
4. The subscription can be scoped to a project or an organization. Use whichever scope is natural
   and simple.

## First release scope

- ChatGPT subscription support through either Codex or Pi is sufficient. Supporting both is
  optional.
- Grok is out of scope for the first version. It is intended for a second version and should be
  considered when designing this feature.

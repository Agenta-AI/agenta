# Composio tools rework

This folder plans a change to how Agenta agents use outside tools like Slack and GitHub,
through a service called Composio.

Today, giving an agent an app means adding one setup entry for every single action, and
an app has about a hundred actions. That is slow and it breaks in several ways. We change
it so the setup names the app once, and the model gets two small tools at run time: a
**search** tool to find an action, and a **run** tool to use it.

## Read in this order

1. **context.md**: the problem in plain words, the bugs it fixes, and what we want.
2. **design.md**: the plan. What we build, how a run works step by step, and what we
   chose not to do.
3. **plan.md**: the three parts we build, in order.
4. **research.md**: background. How things work today, with code references, and what we
   learned from testing against the live Composio key.
5. **api-design.md**: the exact backend changes, for the engineer who builds it.
6. **experiment.md**: two checks to run before we commit to this design. Not run yet.
7. **status.md**: where we are now, what we decided, and open questions.

If you only read one file, read **design.md**.

## Words we use

- **Agent**: what the user builds in Agenta. It runs an AI model and can call tools.
- **Model**: the AI itself (Claude, GPT, and so on).
- **Composio**: the outside service that stores each user's app logins and runs the tool
  calls for us.
- **Connection**: one saved login to one app, like a user's GitHub account.
- **Action**: one operation in an app, like "create an issue".
- **Our backend (the Agenta API)**: our servers. They hold our secret keys and talk to
  Composio.
- **Runner and sandbox**: the runner starts the model in a locked box (the sandbox) and
  gives it tools. Secrets must never enter that box.
- **Search tool and run tool**: the two tools the model gets. Search finds matching
  actions; run uses one.
- **Warm sandbox**: a ready box the runner keeps between turns so the agent starts fast.

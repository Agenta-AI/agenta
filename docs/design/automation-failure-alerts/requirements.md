# Requirements: Automation Failure Notices (v0)

**Status:** Draft. Waiting for agreement before any design work.

An *automation* is a trigger (a schedule or an event subscription) that runs an agent
revision. A *run* is one execution that the automation starts.

## Goal

When an automation stops working on the server, its creator learns about it by email,
without opening the app.

## Scope of v0

| # | Requirement | Decided by |
|---|---|---|
| R1 | Send a notice when a run **fails** (the run ended with an error). | Ashraf |
| R2 | Send a notice when a run **never starts** (the trigger arrived, but the run could not start). | Ashraf |
| R3 | The recipient is the **automation creator**. | Ashraf |
| R4 | Send only on the **first failure**. Later failures send nothing while the automation is in the failing state. | Ashraf |
| R5 | The failing state ends when a run **succeeds** or a user **edits** the automation. The next failure after that sends a new notice. | Ashraf |
| R6 | No "back to normal" email. | Ashraf |
| R7 | Failures caused by the platform (our fault) go to the creator in the same email, with a plain explanation. | Ashraf |
| R8 | The email explains the error in plain language. Raw error text is not sent. | Ashraf |
| R9 | One env switch turns the feature on or off. Default: off. | Ashraf |
| R10 | Email is the only channel in v0. The design must let in-app notices (v1) and other channels (later) plug in without a rewrite. | Ashraf |

## Out of scope for v0

- Runs that start but never finish (stuck runs).
- The schedule cron stopping for everyone.
- In-app notices, Slack, Telegram.
- Recovery emails, digests, reminders.
- Notices to anyone other than the creator, except the fallback in A1.

## Agreed answers

| # | Question | Answer |
|---|---|---|
| A1 | The creator is no longer a project member, or the account is gone. | Send to the organization owner (`organizations.owner_id`, the user's email). |
| A2 | Which changes count as an "edit" for R5? | Any saved change to the automation, including turning it off and on. |
| A3 | Is a run the user cancelled a failure? | No. |
| A4 | Is a run that waits for a human a failure? | No. Any wait for a human blocks the automation (approval, question, or client tool: `user_approval`, `user_input`, `client_tool`), so each sends the "needs attention" email, once per automation. No new one for that automation until someone answers the waiting request, or a user edits the automation. |
| A5 | Many automations fail at the same time for one cause. | One email per automation, no grouping in v0. See "Note for reviewers". |
| A6 | What does the email contain? | Automation name, project, time of the first failure, a plain reason, what to do next, and a link to the automation. |
| A7 | Which editions ship it? | OSS and EE. It sends only when the R9 switch is on **and** an email provider is set up (`env.smtp.enabled` or `env.sendgrid.enabled`, see `api/oss/src/utils/env.py:2110`). Otherwise it logs one warning at startup and sends nothing. |

## Product question for the team

Asked by Ashraf Chowdury.

> If an agent needs a human (an approval, a question, or a client tool) to finish, the automation cannot run on its own. Should the product stop users from creating an automation for an agent whose permissions require a human? Or should it warn them when they create it?

v0 does not depend on the answer. v0 sends the "needs attention" email (A4).

## Note for reviewers: known scaling risks of one email per automation

v0 accepts these risks on purpose. Reviewers should decide if any of them must be solved before v1.

1. **Platform outage.** When the platform fails, every active automation fails together, and every creator gets an email at the same moment.
2. **Inbox flood.** One creator with 50 automations and one cause (for example, an expired API key) gets 50 near-identical emails.
3. **Sender reputation.** If users mark the emails as spam, the provider can rate the sender lower. Alerts share the sender with invites and password resets.
4. **Provider quota.** A burst can hit the SendGrid or SMTP rate limit or daily quota. The cloud plan's limits are not known yet.
5. **Flapping.** A success ends the failing state (R5). A schedule that alternates between failure and success sends one email per cycle.

Grouping per agent was considered. An automation points to its agent only inside the JSON column `data.references` (`api/oss/src/core/triggers/dtos.py:267` and `:332`), and any grouping needs a time window that holds emails back and stores pending state. v0 does not group.

## Finish line for the plan review

The plan is final when:

1. Every requirement above maps to one part of the design.
2. Every fact the design uses has a file and line reference that was read, not assumed.
3. Every scenario in the scenario table has an expected result, and the design gives that result.
4. One full self-review pass finds no defect that changes a requirement or a data shape.

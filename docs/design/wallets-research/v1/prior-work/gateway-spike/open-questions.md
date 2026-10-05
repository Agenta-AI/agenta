# Open questions for Mahmoud

Seven decisions that research cannot make. Each one carries the options, what each costs, and
a recommendation with its reason. The supporting facts live in `findings.md`,
`repo-findings.md`, and `openrouter-api-facts.md`.

---

## 1. Which model class, and what dollar cap

A 30-message trial costs very different amounts depending on the model, and the cap has to
cover the worst case or users hit it early and blame us.

| Option | Cap that covers the worst case | Risk |
|---|---|---|
| Nano class, for example `openai/gpt-5-nano` | $0.30 | The first agent conversation may feel weak, and we would be measuring activation on a model nobody would choose |
| Mini class, for example `openai/gpt-5-mini` | $0.75 | 2.5x the budget ceiling, and prompt caching becomes load-bearing rather than optional |

The worst case is no caching at all plus three LLM calls per user message. On nano that is
about $0.12 for the whole trial, so a $0.30 cap has real headroom. On mini it is about $0.60,
so a $0.30 cap runs out around message 15.

**Recommendation: nano class at a $0.30 cap for the first cohort.** The reason is that the
experiment measures whether a funded first conversation lifts activation, and the cheapest
model that can hold a tool-using conversation answers that question. If the numbers come back
flat, a second cohort on mini tells us whether model quality was the reason. Running mini
first makes the experiment more expensive and does not isolate the variable.

**The thing that would change my mind:** if a hands-on quality test shows a nano-class model
cannot complete a simple agent task in our harness, the trial is worse than no trial. That
test should happen before either cohort ships. It is half a day of work.

---

## 2. May a spendable third-party key enter a user-controlled sandbox

Agent runs execute in a Daytona sandbox the user drives. Any credential we put there can be
read by the user's own agent. The Daytona Secrets work that would hide it (#5277) is parked
and conflicting.

| Option | What it costs | What it risks |
|---|---|---|
| Ship with the capped key visible in the sandbox | Nothing | A user can extract the key and spend its remaining cap outside Agenta until it expires |
| Wait for #5277 to re-land | Blocks the experiment on a parked PR with an unknown date | Nothing new |
| Ship to a small percentage of signups behind a real kill switch | About two days | The same risk, on a smaller population, with a way to stop |

The exposure in plain terms: a stolen trial key is worth at most the cap, on one model if the
guardrail holds, until it expires, and it is traceable to the organization it was minted for.
That is a fundamentally different object from a platform provider key, which is what made this
dangerous in the original analysis.

**Recommendation: ship it, behind a percentage rollout and a real kill switch.** The reason is
that the cap, the expiry, and the model allowlist together turn a catastrophic exposure into a
bounded one, and waiting on #5277 means the activation experiment does not happen this quarter.

**One correction to how I first wrote this.** "Kill switch" has to mean more than a flag.
Stopping new grants and refusing new funded runs does nothing about a key someone already read
out of their sandbox: it keeps working until its cap or its expiry. A switch that actually
stops the bleeding walks every active credential lease and deletes those keys at OpenRouter.
That is a couple of hours of extra work, and without it the word "reversible" is not honest.

**This is a risk-acceptance call, not a technical one, which is why it is on this list.**

---

## 3. How much funded-run authorization to build now

The original proposal mints a signed claim at request acceptance so only interactive playground
runs and direct invokes can draw on the trial, and so a retry cannot charge twice. My first
draft of this spike said defer the whole thing. **A review pass showed that is wrong, and this
question is now narrower than it was.**

What the review found. Every surface converges on the workflow service's `/invoke`: the
playground posts there directly, and evaluations, triggers, detached background jobs, session
resumes, and nested workflow test runs all arrive at the same endpoint. The one field that
looks like a purpose marker, `meta.run_kind`, is supplied by the client and is read after
connection resolution, so it cannot be trusted. And with no invocation identity, a retried
submission consumes a second message.

| Option | Effort | Consequence |
|---|---|---|
| Build the full signed claim now | Roughly a week across three layers | Correct from day one, and more than the experiment needs |
| Build a trusted purpose plus a unique invocation id at `/invoke` acceptance, and consume the allowance there, fail-closed | Roughly three days | Triggers and background jobs cannot silently drain a trial, retries are idempotent, and the seam is the one the gateway extends later |
| Defer all of it and gate only on "this organization has balance" | Roughly a day | A trigger or a nightly job can spend a user's whole trial before they ever type. Retries double-charge |

**Recommendation: the middle option.** The reason the cheapest option looked acceptable and is
not: I had assumed the leak was limited to evaluations, which a user starts on purpose. It is
not. Triggers and detached jobs run without anyone watching, so a user can lose a trial they
never used. That is not a bounded cost, it is a broken product experience with no explanation
attached to it.

**What stays deferred:** the gateway's reservation token and the hold-and-settle protocol. That
is the expensive part and it is genuinely not needed to run an experiment.

---

## 4. Fresh OpenRouter account, or our existing one

Every trial key spends from one OpenRouter credit balance.

| Option | Benefit | Cost |
|---|---|---|
| A dedicated account funded only for trials | A hard financial firewall. If it runs dry, only trials stop | One more account to own, fund, and monitor |
| Our existing account | Nothing new to set up | A runaway trial can drain the balance that other things depend on, and a negative balance returns 402 on every model for every key |

**Recommendation: a dedicated account, with auto top-up off and a manual balance.** The
reason is that OpenRouter's account balance is a shared failure point. A negative balance
fails every request on the account, not just the trial ones. Separating the balance turns a
shared outage into a contained one, and it makes the trial's total spend readable at a
glance.

**The operational consequence to accept:** somebody has to watch the balance and top it up.
A balance alert is the minimum.

---

## 5. Do we ask OpenRouter before shipping

OpenRouter's terms prohibit "reselling API access to Models or otherwise developing a
competing service". Funding a trial inside our own product is not reselling. But we would be
handing working keys to end users' sandboxes, and those users can spend them outside our
product for the life of the key.

| Option | Benefit | Cost |
|---|---|---|
| Ask first and wait for an answer | Certainty. Also a chance to learn the undocumented limits from the source | Days of delay on a support ticket |
| Ask and ship anyway | No delay, and we have the paper trail if it ever comes up | If they say no, we have shipped something we have to unwind |
| Do not ask | No delay | We find out at the worst possible time |

**Recommendation: ask, and ship at the same time behind the percentage rollout.** The reason
is that the same email that asks about the pattern can ask about the key-count cap and the
provisioning rate limit, which are the two things documentation would not tell us. The
rollout percentage keeps the blast radius small while we wait, and the kill switch from
question 2 is how we unwind if the answer is no.

---

## 6. Do we run the probe

`probe_openrouter_keys.py` in this folder settles six things that documentation cannot:
whether guardrails work on our account type, what the cap rejection actually looks like on a
streaming request, whether prompt caching hits, whether key creation is rate limited, what a
blocked model returns, and what expiry does.

It has never been run. It spends a few cents of real money and creates real objects in a real
OpenRouter account.

| Option | Benefit | Cost |
|---|---|---|
| Run it before any implementation starts | The plan stops resting on inference from documentation. About twenty minutes of wall clock | A few cents, plus somebody with a management key |
| Skip it and discover these at implementation time | Nothing saved that matters | The guardrail question in particular could change the design, and finding that out mid-build is expensive |

**Recommendation: run it, on the dedicated account from question 4, before writing any
product code.** The reason is that one answer in it, whether guardrails work, is the
difference between "the cap is the only bound" and "the cap and the model are both bound".
That changes what we tell ourselves about the abuse surface.

Run `--plan` first. It prints every request the script would make and touches no network.
Then `--run --i-have-approval`.

---

## 7. How long is the trial window

The OpenRouter key needs an `expires_at`. The allowance is 30 messages. If those two disagree,
somebody has to decide what happens when the key dies with 20 messages left.

| Option | What it means | The problem it creates |
|---|---|---|
| 24 hours, as originally sketched | The tightest exposure window on a stolen key | Most people who sign up on a Friday come back later and find a dead trial, or we re-mint and hand out a second full dollar cap |
| Seven days, and say so in the product | The window is the promise: "30 free messages, good for seven days" | A stolen key is live for seven days instead of one, still bounded by its cap and its model allowlist |
| No expiry, only the cap | Simplest to explain | A leaked key lives until the cap runs out, and we lose the cheapest bound we have |

**Recommendation: seven days, stated in the product.** The reason is that the mismatch is the
real problem, not the length. One key, one cap, one window, and the countdown the user sees
matches the credential behind it. A re-mint policy is the alternative, and it means minting a
second dollar cap for the same grant, which doubles the ceiling we told ourselves we had.

**What this trades away:** a stolen key is exploitable for a week. At $0.30 on one allowlisted
model, that is not a number worth optimising. If the guardrail turns out not to work on our
account, shorten the window.

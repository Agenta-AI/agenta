# How comparable products present and price a credit system

## 1. The decisions this document has to inform

We are about to give people a balance they spend when they run an agent. Before any of
that becomes code, we have to answer nine product questions. Each one has been answered
in public by other companies, and their users have complained in public about the
answers, so we can read the results instead of guessing.

The nine questions are these. What do we call the thing a person spends, and does it look
like money or like an invented point. What actions take it away. How does a person learn
the price of an action before they take it. How much do we hand out for free, and how
often does that refill. Can a person buy more, and at what rate. Does an unspent balance
survive to next month. What happens the moment the balance hits zero. Where in the
product does the number appear, and how much detail sits behind it. Finally, what happens
to all of this when the person connects their own model provider key.

Our situation adds a tenth question that most of these companies never faced. We will
fund the balance three different ways at once. Some balances come from a provider
relationship that costs us far less than list price. Some balances are sold for cash.
Some balances are given away in exchange for a contribution such as a written skill, an
article, or a video. A single unit has to survive all three origins without feeling
different in each. That constrains the answer more than it first appears, and section 11
returns to it.

## 2. Words used in this document

These terms recur, so here is what each one means in this document.

A **billing unit** is the thing a customer's usage is counted in. Zapier counts "tasks".
n8n counts "executions". Cursor counts dollars. The unit is the noun in the sentence "you
have 4,000 X left".

A **credit** is a billing unit that the vendor invents and hands out in bulk. It is not
money and it is not an action. It sits between the two. A credit only has meaning through
a conversion rule the vendor publishes, or does not publish, such as "an image generation
costs 30 credits".

A **token** is the unit language models are billed in by their providers. Roughly one
token is three quarters of an English word. Some products expose tokens directly to the
end user as the billing unit, which is a deliberate choice and not an accident.

**Metering** means counting consumption as it happens and writing it down. A meter is the
counting mechanism. It is separate from the price.

A **grant** is a balance the vendor gives you without payment. A signup bonus is a grant.
A monthly free allowance is a recurring grant.

A **top-up** is extra balance bought with cash outside the subscription, usually at a
worse rate than the balance bundled into a plan.

**Rollover** means an unspent balance survives into the next billing period. **Expiry**
means it does not, or that it dies after a stated delay. These are different questions and
several products answer them differently for different pools of the same balance.

**Overage** means the vendor lets you keep working past your allowance and bills you for
the excess afterwards. The alternative is a hard stop.

A **seat** is a per-person subscription. Seat pricing charges by how many humans have
accounts, not by how much they run.

**Bring your own key** describes the option where the customer supplies their own model
provider credential, so the model bill goes to the customer directly and the platform
never pays it. Most of the products here offer it. What differs is whether it removes the
platform's charge entirely, partly, or not at all.

**Pass-through** means the vendor charges you exactly what the model provider charged
them, with no addition. **Markup** means they add a margin on top. A vendor can pass model
cost through and still charge separately for their own platform, and several do.

**Prompt caching** is a provider feature where a repeated block at the start of a request
is charged at a large discount, often around a tenth of the normal input price. It matters
here because our harness replays about 23,600 tokens of context on every model call, and
one user message with tool use causes two or three calls. Caching is therefore the
difference between a cheap product and an expensive one, and any unit design that
encourages users or us to break the cached prefix is expensive.

## 3. How the comparison set was chosen

The shape we are matching is a platform where a person who is not a software engineer
builds an automation or an agent, and the platform then calls language models and external
tools on that person's behalf and bills them for it. The billing question is hard in this
shape precisely because the buyer cannot reason about tokens, and because the platform,
not the buyer, decides how many model calls a single request turns into.

Twelve products fit that shape closely enough to be compared question by question.

**Gumloop** is a node based workflow and agent builder aimed at operations teams. It
publishes a per node credit price list, which almost nobody else does.

**n8n** is the largest open source workflow automation tool. It is in the set as the
control case, because it deliberately does not meter model usage at all.

**Langdock** is a European enterprise assistant and agent platform. It is in the set
because it bundles model usage into the seat price and refuses to expose a credit, which
is the opposite end of the design space.

**Dust** is an enterprise agent workspace. It is the most instructive single case in the
set, because it ran a flat unlimited seat plan for two years and then converted to credits
in mid 2026, and because it displays the credit cost of every individual message.

**Lindy** is an agent builder for business users. It charges per step of a workflow rather
than per run, and it has stopped publishing credit numbers on its pricing page.

**Relevance AI** is an agent builder that splits its meter in two, charging separately for
platform actions and for model consumption. That split is directly relevant to us.

**Zapier** is the incumbent automation platform. It is in the set for one policy that
almost nobody else states in writing: failed actions do not consume the unit.

**Make** is the other incumbent. It renamed its long standing unit from "operations" to
"credits" in 2025 while keeping the price identical, which is a clean natural experiment
on what a rename costs.

**Manus** is a general purpose autonomous agent. It is in the set because it is the
clearest example of what happens when a credit is spent by an agent whose cost the user
cannot predict, and because its own help center admits the user cannot see a price first.

**Lovable** builds web applications from chat. It is in the set because it publishes
worked examples of what individual sentences cost, and because it operates two separate
balance pools with different expiry rules.

**Replit** also builds applications from chat. It is in the set because its move to
"effort based" pricing produced the best documented cost shock in this category, reported
by trade press rather than only by forums.

**Cursor** is a developer tool rather than a tool for non engineers, so it is at the edge
of the shape. It is included anyway because it produced two separate, well documented
public failures, one about redenominating the unit in 2025 and one about removing money
from the usage display in 2026. On the display question specifically it is the single
richest source of evidence available.

Six more products are treated in shorter form in section 6, because each teaches exactly
one lesson rather than answering the full question set: v0 by Vercel, GitHub Copilot,
Devin, OpenRouter, Bolt, and Windsurf.

Several obvious names are deliberately excluded. The raw model providers such as OpenAI
and Anthropic sell tokens to developers who can read a token price list, so they never
have to make a unit legible to a non technical buyer. Consumer chat subscriptions show no
meter at all and so answer none of these questions. Salesforce Agentforce is interesting
because it moved from charging per conversation to a flexible credit, but it sells through
an enterprise sales motion with no self service signup, so the display and surprise
questions do not arise the same way. General purpose software with an AI feature bolted on,
such as a whiteboard tool with monthly AI credits, is excluded because the credit is a
small add-on to a product people already bought for other reasons.

## 4. The four ways to name the unit

Before evaluating anything, here is the mechanical landscape. Every product in the set
picks one of four answers, and the choice determines most of what follows.

**Money as the unit.** The balance is denominated in currency. Cursor's Pro plan gives you
"$20 of usage", v0 gives "$5 a month" on the free tier, and OpenRouter simply holds a
dollar balance. Consumption is priced at, or near, the model provider's own token rates.
The advantage is that the number needs no explanation and cannot be quietly devalued. The
disadvantage is that it publishes your cost basis, so a customer can compute your margin,
and it makes every model price change visible to the customer immediately.

**An abstract credit.** The balance is a made up point. Gumloop, Dust, Lindy, Manus,
Lovable, and Make all do this. The vendor sets a conversion from real consumption to
credits and can change it. The advantage is that one number covers model calls, tool calls,
compute time, and third party data lookups without exposing four different price lists. The
disadvantage is that the number means nothing on its own, so the vendor has to teach it,
and every conversion change is a price change that looks like a rounding detail.

**A count of user actions.** The balance counts things the user did, not resources
consumed. Zapier counts successful action steps. n8n counts whole workflow runs. Windsurf
now counts prompts the user typed. The advantage is enormous legibility, because the user
can count their own actions before committing. The disadvantage is that the vendor absorbs
all variance. A workflow run that calls a model fifty times costs the same as one that
sends a Slack message, so the vendor is exposed on the expensive tail.

**No meter at all.** The seat price includes usage. Langdock does this for chat and agents,
and Dust did it until mid 2026. The advantage is complete predictability for the buyer,
which enterprise buyers say they prefer. The disadvantage is that agent usage has a very
long tail, and this design has been abandoned repeatedly as agents got more expensive.

The direction of travel across the set is clear. Products that started with action counts
or unlimited seats have been moving toward abstract credits or money, because agents made
the variance too large to absorb. Every one of those moves produced a public backlash. That
pattern, and not any individual product's current price, is the most useful thing in this
document.

## 5. The twelve products, one at a time

### Gumloop

Gumloop is a workflow and agent builder where the user assembles nodes on a canvas. The
unit is a credit, and Gumloop is unusual in publishing a real price list for it.

Its documentation states that every workflow execution costs one base credit, and that
most native nodes, including text manipulation, logic, loops, data transformation, and most
integrations, cost nothing further. On top of that, specific node types carry fixed prices:
contact or company enrichment costs 60 credits, a company search costs 30, email validation
costs 10, web scraping runs 1 to 10 depending on the tool, custom and connector nodes cost
3 each, image generation costs 30, and audio transcription costs roughly 1 to 2 credits per
minute. Model calls are the exception to the fixed price list. Those are billed by token
usage according to the model chosen
([docs.gumloop.com/core-concepts/credits](https://docs.gumloop.com/core-concepts/credits)).

Credits do not roll over month to month, except on enterprise plans, according to the same
page. The paid plan is $37 per month with a stated "20k+ credits/month", and the pricing
page carries a slider offering preset volumes from 20,000 up to 1.5 million credits, with a
20 percent annual discount and a 14 day trial
([gumloop.com/pricing](https://www.gumloop.com/pricing)). The pricing page does not publish
a top-up rate; a third party pricing tracker reports overage at $0.005 per credit, which I
could not confirm against Gumloop's own pages, and which would sit about 2.7 times above
the bundled rate implied by $37 for 20,000 credits
([automationatlas.io](https://automationatlas.io/answers/gumloop-pricing-explained-2026/)).
The same tracker reports that Gumloop discontinued its permanent free plan around July 2026
in favour of a trial, which is also unconfirmed against Gumloop's own pages. Checking the
signup flow for a logged-out account would settle both.

Two Gumloop behaviours are worth stealing and are covered in section 9. First, bringing
your own model key does not remove credits but halves the credit cost of model calls on
paid plans, which keeps the platform's own value metered while removing the model cost
([docs.gumloop.com/core-concepts/credits](https://docs.gumloop.com/core-concepts/credits)).
Second, per third party reporting that I could not confirm in Gumloop's own documentation,
an agent can be given a per conversation credit threshold; when a single chat crosses it,
the agent pauses and raises an approval request rather than continuing to spend. If that is
real, it is the best answer anyone in this set has to runaway agent spend. Opening a
Gumloop trial account and inspecting the agent settings panel would settle it.

The one confirmed Gumloop complaint is small but revealing. A user wrote to the forum
saying they had run out of credits in February and expected a refill in March that never
came. Support explained that free plan credits refill on the anniversary of the signup
date, not on the first of the month
([forum.gumloop.com](https://forum.gumloop.com/t/no-new-credits-for-the-month/1720)). The
rule is defensible. The user still lost weeks assuming otherwise.

### n8n

n8n is the control case. It bills for workflow runs and does not meter model usage at all.

Its pricing page defines the unit plainly: "An execution is a single run of your entire
workflow. It doesn't matter how many steps are in the workflow or how much data it
processes, it's still a single execution." Plans on annual billing run from €20 a month for
2,500 executions, through €50 for 10,000, to €667 for 40,000. Exceeding the allowance does
not stop workflows; overage is billed afterwards
([n8n.io/pricing](https://n8n.io/pricing/)).

Model usage is entirely the customer's problem. Users connect their own provider keys for
model nodes. n8n's separate AI assistant, which helps you build workflows rather than run
them, does carry a monthly credit allowance on cloud plans, and the self hosted version
expects your own key so no credit limit applies. That is the cleanest statement of the
bring your own key position in the set: the platform charges for the platform, and the
model is between you and the provider.

Even this simple unit confuses people, which is the useful finding. Under n8n's own pricing
announcement thread, a user asked: "So let's say I have a nightly trigger for a workflow and
this workflow runs a loop 10 times triggering a sub workflow. Is this charged 11 times or 1
times with the new price structure? Does it make a difference if I make the sub workflows
run in parallel?"
([community.n8n.io](https://community.n8n.io/t/new-plan-no-active-workflow-limits-introducing-n8n-new-pricing/163840)).
If a unit as concrete as "one workflow run" needs that question asked, an abstract credit
will need it asked constantly.

The same thread carries the other predictable complaint, from self hosted users who feel
double charged. One wrote: "We use our own computing power and n8n servers are not used. It
is like adobe charging you every time you use the picking color tool." Another, running
several self hosted instances, wrote that "paying per execution on top of that often feels
like being charged twice for the same capacity." That objection applies to us in the open
source edition and is worth keeping in view.

### Langdock

Langdock sells an enterprise assistant and agent workspace, mainly in Europe, and it is the
strongest example of the no meter design.

Its documentation states that chat and agents are priced by seat, and that "included AI
model usage in Chat & Agents is covered by your seat price". There is no credit unit at all
for that surface. Customers who want to supply their own provider key can, and then they
pay the provider directly. Two other surfaces are metered differently: workflows are sold in
packages by monthly run count, and direct programmatic access is billed per token at rates
matching the model provider's own, with a default spending limit of €100 per month on a
workspace key that customers can ask to have raised. When a seat exceeds its included usage,
an administrator can enable "extra usage", which turns on usage based charging
([docs.langdock.com/administration/pricing](https://docs.langdock.com/administration/pricing)).

Third party sources report the seat price at €20 to €25 per user per month, which I did not
confirm on Langdock's own pricing page. The structural facts above come from Langdock's own
documentation and are the ones that matter.

The lesson is that this design survives here because the buyer is a company buying seats for
staff who chat, and chat has a bounded appetite. Agents that run tools in a loop do not.
Langdock itself meters workflows and programmatic access separately, precisely because those
are the unbounded surfaces. That is a real signal for us: the surface where an agent runs
autonomously is the surface everyone meters, even the companies that refuse to meter
everything else.

### Dust

Dust is the single most instructive case in the set, because it changed sides.

For about two years Dust sold a flat seat with unlimited messages. In mid 2026 it converted
to a credit metered structure with three seat types. A pricing tracker dates the change to
24 June 2026 and describes the old plan as a flat €29 per seat with unlimited messages
([usagepricing.com](https://www.usagepricing.com/blueprint/activity/dust-2026-06-24-price-change)).
I could not load Dust's own pricing page, so treat the prices as third party: a free seat
with a one time 500 credits, a Pro seat at $30 a month with 8,000 credits, and a Max seat at
$150 a month with 40,000 credits.

Dust's own documentation is clear about the unit and is worth quoting: "A credit represents
a unit of AI work performed on Dust." The credit has two components. Token credits scale
with the size of the context and the capability of the model. Action credits are a fixed
charge per tool use, tiered by capability: internal tools such as memory and file management
cost zero, ordinary actions such as web search and running another agent cost 1, and heavier
actions such as data retrieval, image generation, and external integrations cost 3. Credits
"do not roll over to the next billing period", and monthly credits reset on the subscription
anniversary ([docs.dust.tt/docs/credits](https://docs.dust.tt/docs/credits)).

The most valuable single sentence in this entire document is also from that page: "After
each message, Dust shows the credit cost of that interaction directly in the conversation."
That is the answer to the display question. It puts the price next to the thing that
incurred it, at the moment it was incurred, where a person can build an intuition without
opening a billing screen. Nobody else in the set does this as directly.

Dust's documentation does not say what happens at zero, which is a gap. Third party sources
say Pro and Max seats can exceed the allowance only through an administrator enabled and
capped workspace overage, and that programmatic use is billed at $0.01 per credit. Both are
unconfirmed. A trial account on a paid seat would settle both.

### Lindy

Lindy is an agent builder for business users, and it is in this set mostly as a warning about
transparency going backwards.

Lindy's own pricing page lists Plus at $49.99, Pro at $99.99, Max at $199.99, and a custom
enterprise tier. It does not publish credit counts. Instead it describes the tiers in
relative terms: Plus is "Standard usage", Pro offers "3x more usage than Plus", and Max
offers "7x more usage than Plus" ([lindy.ai/pricing](https://www.lindy.ai/pricing)). A buyer
cannot compute anything from that. They cannot compare Lindy to a competitor, and they
cannot estimate their own bill.

Third party write-ups report a free tier of 400 credits a month, a floor of 1 credit per
task, roughly 1 to 3 credits on basic models and around 10 on advanced ones, and,
importantly, that credits are consumed per step of a workflow rather than per run. I could
not confirm any of that against Lindy's own documentation, and the per step claim is the one
that matters most, because per step metering is exactly what confused n8n's users when the
unit was per run. Reading Lindy's in-product usage page on a trial account would settle it.

The takeaway does not depend on the unconfirmed numbers. A pricing page that describes usage
as a multiple of an unstated base is a pricing page that has given up on legibility.

### Relevance AI

Relevance AI is an agent builder that runs two meters instead of one, and that structure is
the most directly transferable idea in the set for a platform that intends to pass model
cost through.

Third party sources, consistent with each other, report that since September 2025 Relevance
splits billing into Actions, which count what the agent does, and Vendor Credits, which
cover model cost. Actions are charged per tool run, at 4 credits per run on free and entry
plans, 3 on a team plan, and 2 on higher plans, so a bigger subscription lowers the platform
charge per action. Vendor Credits are described as pass-through, with the platform taking no
markup on model cost. Top-ups are reported at $40 per 1,000 Actions and $20 per 10,000
Vendor Credits
([eesel.ai](https://www.eesel.ai/blog/relevance-ai-pricing),
[checkthat.ai](https://checkthat.ai/brands/relevance-ai/pricing)). Relevance's own public
pricing page now shows only enterprise features and a "Talk to sales" button, with no unit
definitions or amounts ([relevanceai.com/pricing](https://relevanceai.com/pricing)), so all
of the above is unconfirmed against the vendor. A trial account, or the product's own
documentation behind login, would settle it.

The idea survives the uncertainty. Separating "what our platform did for you" from "what the
model provider charged" lets the platform hold a stable, understandable price for its own
work while the model layer moves underneath. It also makes bring your own key trivial to
express: the vendor meter keeps running and the model meter goes to zero.

### Zapier

Zapier is the incumbent, and it earns its place here for one sentence of policy.

Its pricing page defines the unit as follows: "A task is counted whenever Zapier
successfully completes a unit of work for you. Failed actions are not counted." Triggers,
polling, and built in utilities such as filters, paths, formatting, delays, looping, storage,
tables, and forms consume nothing. The free plan includes 100 tasks a month and resets
monthly even on annual billing. Paid plans start around $19.99 a month on annual billing for
750 tasks. Model steps do cost more than ordinary ones, priced by tier, and are charged per
step plus per tool call. When you exceed your allowance, the behaviour depends on a setting
you control in advance: with pay per task enabled, work continues and overage is billed at
2.5 times the base rate on monthly plans and 1.25 times on annual ones; with it disabled,
usage stops until the next cycle ([zapier.com/pricing](https://zapier.com/pricing)).

Three things there are worth copying and are picked up in section 9: failures are free and
this is stated in writing, the platform's own plumbing is free so users are not taxed for
using control flow, and the behaviour at zero is a switch the customer sets before they hit
it rather than a surprise they discover afterwards.

### Make

Make is the natural experiment on renaming a unit.

For years Make counted "operations", where every module in a scenario consumes one operation
per bundle of data it handles. On 27 August 2025 it renamed the billing unit to "credits".
Make's own help center is unusually blunt about the mechanics: "all of your existing
operations have been automatically converted to credits at a 1 1 ratio (for example, your
1000 operations are now 1000 credits)", existing plans and prices "remain unchanged", and
for ordinary modules "1 operation still uses 1 credit"
([help.make.com](https://help.make.com/introducing-credits-new-billing-unit-live-in-make)).

The reason for the rename is the model layer. Under the new unit, a module that calls a
model through Make's own built in provider consumes credits calculated from tokens and model
tier rather than a flat 1, and Make notes that credit usage "may increase if you're using
make's ai provider". Running code is charged by time. If you connect your own provider key,
you pay Make one credit for the operation and pay the model provider yourself
([help.make.com/credits](https://help.make.com/credits)). When credits run out mid cycle,
you upgrade, buy extra credits, or enable automatic purchase of extra credits.

This is a well executed migration, and the design deserves attention: a single word now
covers a fixed price for ordinary work and a variable price for model work, and the two are
distinguished by which connection you used. But it is still hard to answer in advance. On
Make's own community forum a user asked what an AI agent run actually costs, having searched
the public pages and failed to find it. The answer, from a community member rather than the
company, was that it depends on the model and combined input and output tokens, with some
modules priced by time instead
([community.make.com](https://community.make.com/t/what-is-the-ai-agent-pricing-model/98179/3)).
The question was reasonable and the public pages did not answer it.

### Manus

Manus sells a general purpose autonomous agent, and it is the clearest illustration of what
happens when an abstract credit meets an agent whose behaviour the user cannot predict.

Manus's own help center says credits are consumed by three things: model tokens for planning
and output, virtual machines for the cloud environment the agent works in, and third party
interfaces the agent calls. Consumption depends on the complexity and duration of the task.
Free users get daily credits that refresh at midnight, capped at 1,500 credits a month, and
usable only on a smaller model. Subscription credits refresh on the subscription anniversary.
Unused credits generally do not carry over, purchased add-on credits do carry over while a
paid subscription is active, and free credits do not expire
([help.manus.im](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them)).
Third party reporting, which I did not confirm, puts a simple chat at 5 to 15 credits and a
complex research task at 500 to 900.

The critical admission sits in a separate help article, which exists because so many people
asked. Asked whether you can check what a task will cost before you start it, Manus answers:
"At present, Manus does not possess the capability to autonomously judge or regulate the
consumption of credits." The article goes on to describe real time visibility and pre task
estimates as an aspiration for the future
([help.manus.im](https://help.manus.im/en/articles/13185575-is-there-a-way-to-check-how-many-credits-a-task-will-cost-before-i-begin)).

That single sentence explains most of the complaint volume around this product. Third party
summaries report users burning an entire allowance on one task and getting nothing usable
back, and no way to budget in advance
([eesel.ai](https://www.eesel.ai/blog/manus-ai-pricing)). Manus does have one good policy
that partly offsets this: the help center offers "a full refund of consumed credits for
tasks that fail due to technical issues on our end." That draws the line in the right place,
even though it puts the burden of claiming on the user.

### Lovable

Lovable turns chat into working web applications, for people who mostly cannot code. Its
credit design is the most elaborate in the set, and it publishes worked examples.

Lovable's documentation splits usage into three kinds: building, meaning the messages you
send to plan and edit your application; hosting and backend for the application itself; and
model features the deployed application uses. There are two pools of balance with different
rules. Daily build credits, 5 per day on every plan and capped at 30 a month on the free
plan, refresh at midnight UTC and expire at the end of the day. Monthly plan credits roll
over, but expire two months after issue on monthly plans, or one month after the annual term
ends. Purchased top-up credits are valid for twelve months. When you run out, "building
stops", model features inside deployed applications stop working, and applications relying
on the hosted backend can pause. The balance is visible from the dashboard, the project
editor, and the settings page
([docs.lovable.dev](https://docs.lovable.dev/introduction/plans-and-credits)).

The genuinely good idea is on the pricing page, which shows what individual sentences cost:
"Make the button gray" is 0.50 credits, "Remove the footer" is 0.90, "Add authentication with
sign up and login" is 1.20, and "Build me a landing page, use images" is 1.70. A planning
message costs 1 credit flat ([lovable.dev/pricing](https://lovable.dev/pricing)). Those four
examples do more to teach the unit than any definition could, because a reader can place
their own intended work between them.

The weak point is the same as everywhere else in this category. Lovable's documentation says
that stopped requests are "charged based on the work completed so far", so a build that goes
wrong partway still costs something. Third party guides report that automatic "try to fix"
messages for system errors are generally free, which is the right policy, but community
reporting describes users caught in loops where each fix attempt burns balance without
progress ([shipper.now](https://shipper.now/lovable-errors/)). I could not reach Reddit
directly to quote users, because it blocks automated fetching; the pattern is reported
consistently by secondary sources, and confirming it would need a logged in account or a
manual browser session.

### Replit

Replit is in this set because it produced the best documented cost shock in the category,
and because a trade publication rather than a forum reported it.

Replit moved to what it calls effort based pricing in mid 2025, where the charge for a
request depends on how much work the agent decided to do rather than on a count of user
actions. In September 2025, after the launch of a more autonomous agent, The Register
reported users seeing bills jump by an order of magnitude. One user said "I spent $1k this
week alone" against a previous average of $180 to $200 a month. Another reported spending $70
in a single night, and said one prompt cost $20 and produced an unwanted result. A third
wrote that "Before September 11th, expenses were reasonable. With Agent 3, in just one
weekend, costs skyrocketed." The Register noted it had asked Replit for comment and had not
received one at publication
([theregister.com](https://www.theregister.com/2025/09/18/replit_agent3_pricing/)). InfoWorld
covered the same episode
([infoworld.com](https://www.infoworld.com/article/4059876/replit-update-sparks-developers-dissatisfaction-over-pricing.html)).

The structural lesson is precise, and it applies to us directly. Nothing about the price list
changed. What changed was that the agent got more autonomous, so the same sentence from the
user now caused far more work. When the unit measures effort and the vendor controls how
much effort a request triggers, every capability improvement is also a silent price
increase. Our own harness has exactly this property, because the number of model calls per
user message is our choice and not the user's.

### Cursor

Cursor is a developer tool, so it sits at the edge of the comparison set, but it has produced
two clean public failures that answer two of our nine questions better than any other source.

The first is redenomination. In June 2025 Cursor replaced a request based allowance with a
money based one. Its own blog post describes the old unit as 500 requests a month, with some
models counting as two requests, and the new arrangement as $20 of usage at model provider
rates plus unlimited use of an automatic model selector. The post admits the failure
directly: "We were not clear that 'unlimited usage' was only for Auto and not all other
models", and "Our communication was not clear enough and came as a surprise to many." Cursor
offered to "refund any unexpected charges you may have incurred for usage over the past 3
weeks" ([cursor.com/blog/june-2025-pricing](https://cursor.com/blog/june-2025-pricing)).
TechCrunch covered the apology
([techcrunch.com](https://techcrunch.com/2025/07/07/cursor-apologizes-for-unclear-pricing-changes-that-upset-users/)).
A user on Cursor's own forum captured the resulting experience: "the most confusing thing is
closing Cursor having 74% used credit and open with 79%"
([forum.cursor.com](https://forum.cursor.com/t/new-pricing-for-cursor-is-confusing/154203)).

The second failure is more recent and more directly about display. At the end of July 2026,
Cursor removed dollar amounts from the usage page for self service plans and left only token
counts. The forum thread is the best evidence in this document about what users want from a
balance display, so it is worth several quotes. The first poster wrote that the change made
the page "completely useless" for keeping tabs on daily spending. Another wrote: "Cursor
needs to be transparent about the per-request cost if that is what we are being billed for."
A team administrator with a large monthly spend asked simply, "How can I track the per-user
and per-model spend like before???" Another user objected to the substitution itself: "Who
cares about tokens? It's irrelevant as it's highly different to each model."

Cursor's staff answer explains the reasoning, and the reasoning is instructive because it is
not unreasonable. A team member wrote that dollar amounts had been shown briefly for
individual plans, "but that led to some confusion because the dollar amounts displayed were
often higher amounts than the user's plan cost (due to the generous included usage)". In
other words, showing a customer that they consumed $60 of model usage on a $20 plan made
them think they were about to be billed $60. The company solved that confusion by removing
the number, and created a much worse one. A user summarised the effect: "It is so sketchy to
be removing something like this." Another pointed out that the change was applied
retroactively to historical records read through the interface
([forum.cursor.com](https://forum.cursor.com/t/usage-page-to-token-amount-what/167153)).

## 6. Six more products, each for one specific lesson

**v0 by Vercel** shows that money denominated credits work fine for a non expert audience.
Its blog post describes the move from fixed message counts to input and output tokens
converted into monthly credits, and says the goal was "more predictable pricing as you grow"
plus a larger free tier. Free users get $5 a month of credits, paid users $20, and team
members $30 each, with purchased credits expiring after a year
([vercel.com/blog/updated-v0-pricing](https://vercel.com/blog/updated-v0-pricing)). Third
party reporting adds a detail worth noting: paid seats also receive a small credit just for
logging in on a given day, which is a daily habit incentive rather than a billing mechanism.

**GitHub Copilot** shows the cost of a multiplier table. Its abstract unit is a "premium
request", and each model carries a multiplier against it, so a code review consumes 13 of
them and choosing automatic model selection earns a 10 percent discount. Extra premium
requests cost $0.04 each. Crucially, GitHub's documentation states that for agent features,
"only the prompts you send count as premium requests; actions Copilot takes autonomously to
complete your task, such as tool calls, do not"
([docs.github.com](https://docs.github.com/copilot/concepts/copilot-billing/understanding-and-managing-requests-in-copilot)).
That is a deliberate decision to charge for user intent rather than agent effort, and it is
the opposite of Replit's choice. GitHub now labels the whole premium request arrangement as
legacy, and its own documentation states that the article describing it applies only to
annual plan subscribers who stayed on request based billing after 1 June 2026, with everyone
else moved to usage based billing
([docs.github.com](https://docs.github.com/copilot/concepts/copilot-billing/understanding-and-managing-requests-in-copilot)).
So even the company that built the most elaborate abstract unit in this set is retiring it.

**Devin** shows what a normalized compute unit costs in comprehension. Its unit bundles
virtual machine time, model inference, and network into one number priced around $2 to $2.25
each. Devin's own public billing documentation says only that enterprise customers are
"billed in Agent Compute Units (ACUs) at the rate set in their order form" and does not
define the unit on that page
([docs.devin.ai/admin/billing](https://docs.devin.ai/admin/billing)). Third party guides
converge on roughly 15 minutes of active work per unit and report single features consuming
30 to 60 units. A unit that mixes three different resources cannot be predicted by the user,
because they cannot predict any of the three.

**OpenRouter** is the closest existing thing to the gateway we are building, and it uses
money as the unit with no abstraction at all. The balance is dollars, model prices are passed
through at the provider's own rates, and the platform takes a fee on credit purchase rather
than on inference, reported by third parties at 5.5 percent. Two mechanisms are worth noting.
Bringing your own provider key costs 5 percent of what the call would have cost, waived for
the first million such requests a month
([openrouter.ai/docs/features/byok](https://openrouter.ai/docs/features/byok)). And the free
model tier is gated on the balance: fewer than $10 of credits ever purchased gives 50 free
requests a day, $10 or more raises that to 1,000, and a zero or negative balance blocks free
models entirely with a payment error
([openrouter.ai/docs/api-reference/limits](https://openrouter.ai/docs/api-reference/limits)).
That is an elegant answer to abuse of a funded free tier, and it is directly relevant to us.

**Bolt** shows what happens when you name the unit after the provider's unit. Bolt's balance
is denominated in tokens, so users talk about millions of tokens rather than dollars or
credits. Paid tokens roll over for one extra month on a first in, first out basis, free plan
tokens do not roll over, and on-demand purchases run around $20 per 10 million tokens
([support.bolt.new](https://support.bolt.new/account-and-subscription/tokens)). The failure
mode is severe and widely reported: when the agent gets stuck in a loop trying to fix its own
error, it can consume enormous quantities, with secondary sources citing users who spent 10
million tokens failing to fix one bug and reviewers estimating that up to half their tokens
went to errors ([superdesign.dev](https://superdesign.dev/blog/bolt-review)). I could not
confirm those individual accounts at source because the underlying discussions are on Reddit,
which blocks automated fetching.

**Windsurf** shows that simplifying a unit is possible and appreciated, but that the way you
do it still matters. Windsurf originally ran two balances at once, prompt credits for
messages the user sent and flow action credits for the steps the agent then took. It removed
flow action credits, so a request that previously cost 4 flow credits now costs 1 prompt
credit, and settled on a single plan at $15 a month with 500 prompt credits and top-ups at
250 credits for $10 ([geekflare.com](https://geekflare.com/news/windsurf-made-its-pricing-plans-a-lot-simpler/)).
Coverage notes that some users still felt the underlying allowance had been quietly reduced.
The lesson is that collapsing two meters into one is the right move, and that users will
still check whether the collapse was revenue neutral.

## 7. Side by side

The first table covers the unit and what takes it away. "Price list public" means a person
can find the cost of a specific action before performing it, on a public page.

| Product | Unit name | Unit type | What consumes it | Price list public |
|---|---|---|---|---|
| Gumloop | Credit | Abstract | 1 per workflow run, fixed prices per special node, tokens for model nodes | Yes, per node |
| n8n | Execution | Action count | One whole workflow run, any size | Yes, and trivially |
| Langdock | None for chat | No meter | Seat price covers chat and agents; workflows by run; direct access by token | Partly |
| Dust | Credit | Abstract | Token credits by context and model, plus fixed action credits of 0, 1, or 3 per tool | Tiers yes, token rate no |
| Lindy | Credit | Abstract | Reported per workflow step, more on stronger models | No |
| Relevance AI | Action and Vendor Credit | Abstract, split in two | Actions per tool run, Vendor Credits for model cost at cost | No longer |
| Zapier | Task | Action count | Each successfully completed action step; model steps cost more | Yes |
| Make | Credit | Abstract | 1 per module run; token based for its own model provider; time based for code | Yes |
| Manus | Credit | Abstract | Model tokens, virtual machine time, third party calls | No |
| Lovable | Credit | Abstract | Build messages, hosting, model features in deployed apps | Yes, by worked example |
| Replit | Money | Money | Agent effort, decided by the agent | No |
| Cursor | Money | Money | Model tokens at provider rates | Yes, provider rates |

The second table covers the economics around the unit.

| Product | Free allowance and refresh | Buy more | Rollover and expiry | Own model key | At zero |
|---|---|---|---|---|---|
| Gumloop | Trial only, reported; refill on signup anniversary | Overage toggle, rate not published | No rollover except enterprise | Halves model credit cost on paid plans | Overage if enabled |
| n8n | Trial with 800 assistant credits | Overage billed after | Not applicable | Required for all model nodes | Runs on, billed after |
| Langdock | 7 day trial | Extra usage toggle per seat | Not applicable | Supported, pay provider direct | Extra usage or stop |
| Dust | 500 credits once on a free seat | Reported capped workspace overage | No rollover, resets on anniversary | Not documented | Not documented |
| Lindy | Reported 400 a month | Plan upgrade | Not documented | Not documented | Not documented |
| Relevance AI | Reported small free tier | Reported $40 per 1,000 actions | Not documented | Vendor credits are pass-through | Not documented |
| Zapier | 100 tasks a month, monthly reset | Overage at 2.5x monthly, 1.25x annual | Monthly reset | Supported as a model tier | Customer's pre-set switch |
| Make | Free tier exists | Extra credits, optional auto purchase | Not documented on that page | Own key gives 1 credit per operation | Upgrade or buy |
| Manus | Daily refresh capped at 1,500 a month | Add-on credits | Add-ons carry over, monthly credits do not, free credits never expire | Not offered | Stop |
| Lovable | 5 a day, up to 30 a month | Top-ups valid 12 months | Daily expire nightly; monthly roll but die after 2 months | Not for building | Building stops, deployed apps can pause |
| Replit | Trial | Automatic overage | Not documented | Not for the agent | Billed on |
| Cursor | Limited free tier | On demand spend | Included usage resets monthly | Supported historically | Stops unless on demand enabled |

## 8. What users actually complain about

The complaints cluster into six patterns. Each is evidenced below.

**You cannot learn the price before you commit.** This is the most common complaint and the
most damaging, because it makes a person feel they are gambling. Manus states the problem in
its own help center rather than denying it: "At present, Manus does not possess the
capability to autonomously judge or regulate the consumption of credits"
([help.manus.im](https://help.manus.im/en/articles/13185575-is-there-a-way-to-check-how-many-credits-a-task-will-cost-before-i-begin)).
On Make's forum, a user searched the public pages for what an agent run costs and had to ask
the community instead
([community.make.com](https://community.make.com/t/what-is-the-ai-agent-pricing-model/98179/3)).
Under Replit's effort based pricing, the agent decides how much work to do, so there is no
number to show before the fact. Trade coverage of the resulting bills is in the Replit
section above.

**The vendor's own failures spend your balance.** Users accept paying for work. They do not
accept paying for the vendor's bugs. Bolt's error loops are the extreme case, with secondary
reporting of ten million tokens consumed failing to fix a single error and reviewers
estimating half their consumption went to errors
([superdesign.dev](https://superdesign.dev/blog/bolt-review)). Lovable users describe the same
fix and break cycle ([shipper.now](https://shipper.now/lovable-errors/)). Replit users
reported being billed for runs that failed or hung. Two companies handle this correctly and
say so in writing. Zapier's pricing page states "Failed actions are not counted"
([zapier.com/pricing](https://zapier.com/pricing)). Manus offers "a full refund of consumed
credits for tasks that fail due to technical issues on our end"
([help.manus.im](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them)).

**The unit maps to nothing a person can picture.** A credit is not a thing anyone has an
intuition for. An industry write-up quotes a go to market lead at a productivity company
saying "Our finance team likes it. Our customers don't know what a credit does", and a head
of product monetization saying "We don't love credits, but we didn't have time to define
outcomes" ([metronome.com](https://metronome.com/blog/the-rise-of-ai-credits-why-cost-plus-credit-models-work-until-they-dont)).
Even concrete units fail this test when composition enters the picture, as with the n8n user
asking whether a loop of ten sub workflows counts as one execution or eleven
([community.n8n.io](https://community.n8n.io/t/new-plan-no-active-workflow-limits-introducing-n8n-new-pricing/163840)).
A Cursor user put the general objection sharply when tokens replaced dollars: "Who cares
about tokens? It's irrelevant as it's highly different to each model"
([forum.cursor.com](https://forum.cursor.com/t/usage-page-to-token-amount-what/167153)).

**The exchange rate moves under you.** Because the vendor controls the conversion from real
consumption to credits, every cost change can be pushed onto the customer without a visible
price rise. A pricing consultancy compares this to airline miles, which it says devalue at
about 15 percent a year, and cites Cursor's June 2025 shift as the AI example, with users
exhausting allowances after two or three complex prompts
([softwarepricing.com](https://softwarepricing.com/blog/credit-based-pricing-ai/)). Cursor's
own apology confirms the substance if not the framing
([cursor.com/blog/june-2025-pricing](https://cursor.com/blog/june-2025-pricing)). Windsurf's
users made the same accusation when its two credit types collapsed into one, suspecting the
underlying allowance had shrunk.

**The balance display gets worse over time, and users read that as dishonesty.** This is the
most recent and best documented pattern, from Cursor's forum at the end of July 2026 when
dollar figures were removed from the usage page for self service plans. Users called the
page "completely useless", demanded "transparency about the per-request cost", asked "How can
I track the per-user and per-model spend like before???", and described the change as
"sketchy". One noted that the cost fields also went to zero for historical records
([forum.cursor.com](https://forum.cursor.com/t/usage-page-to-token-amount-what/167153)). The
company's stated reason was that showing real consumption in dollars confused customers whose
consumption exceeded their plan price. That is a genuine problem with a genuine solution,
which is to label the number clearly, not to delete it.

**Refresh and expiry dates surprise people.** These rules are boring until they cost someone
a month. A Gumloop user assumed a calendar month refill and learned that free credits refill
on the signup anniversary ([forum.gumloop.com](https://forum.gumloop.com/t/no-new-credits-for-the-month/1720)).
Dust states plainly that credits "do not roll over"
([docs.dust.tt/docs/credits](https://docs.dust.tt/docs/credits)). Lovable runs two pools with
different rules at once, where daily credits die nightly and monthly credits roll over but
then expire two months after issue
([docs.lovable.dev](https://docs.lovable.dev/introduction/plans-and-credits)). Every added
rule is another thing a support agent will have to explain.

For scale, an industry survey of 218 information technology leaders found that 78 percent
had experienced unexpected charges tied to AI or consumption in the previous year, as cited
in a buyer's guide to credit pricing
([blog.hubspot.com](https://blog.hubspot.com/website/ai-credits-buyers-guide)). I did not
read the underlying survey, so treat the figure as reported rather than verified.

One limitation is worth stating. Reddit is where most of this category's users complain, and
it blocks automated fetching, returning a 403 error for both direct requests and reader
proxies. The complaints above therefore come from vendor forums, which are fetchable and
which have the advantage of carrying the company's own replies, plus trade press and
secondary summaries. Manually browsing the relevant subreddits while logged in would add
volume but is unlikely to change the six patterns.

## 9. Patterns worth copying

**Publish a price for each action, and teach it with worked examples rather than a formula.**
Gumloop's node price list lets a builder reason about a workflow before running it
([docs.gumloop.com/core-concepts/credits](https://docs.gumloop.com/core-concepts/credits)).
Lovable does better by pricing four ordinary sentences on its public pricing page, from "Make
the button gray" at 0.50 credits to "Build me a landing page, use images" at 1.70
([lovable.dev/pricing](https://lovable.dev/pricing)). A reader places their own work between
those examples in seconds. A formula involving tokens takes minutes and is usually skipped.

**Show the cost of the thing you just did, where you did it.** Dust prints the credit cost of
each interaction inside the conversation
([docs.dust.tt/docs/credits](https://docs.dust.tt/docs/credits)). This converts a meaningless
unit into a learned intuition after about ten messages, and it removes the need for the user
to visit a billing page at all. Nothing else in the set has this property.

**Do not charge for your own failures, and put that promise in writing.** Zapier states
"Failed actions are not counted"
([zapier.com/pricing](https://zapier.com/pricing)). Manus refunds credits for tasks that fail
for technical reasons on its side
([help.manus.im](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them)).
The absence of such a promise is what turns a bug report into an accusation of theft, as the
Bolt and Lovable error loop complaints show.

**Do not charge for the platform's own plumbing.** Zapier exempts triggers, filters, paths,
formatting, delays, loops, storage, and forms
([zapier.com/pricing](https://zapier.com/pricing)). Gumloop exempts text manipulation, logic,
loops, and data transformation
([docs.gumloop.com/core-concepts/credits](https://docs.gumloop.com/core-concepts/credits)).
Users resent paying for structure. They accept paying for capability.

**Cap a single run and ask before exceeding the cap.** Gumloop reportedly lets an agent be
given a per conversation credit threshold, at which point the agent pauses and raises an
approval request. Cursor's forum carries a feature request titled "Limit cost per task"
([forum.cursor.com](https://forum.cursor.com/t/limit-cost-per-task/162936)). Every runaway
cost story in section 8 is a story about a single run that nobody stopped.

**Let the customer choose the behaviour at zero in advance.** Zapier's pay per task switch
decides ahead of time whether work continues into overage or stops
([zapier.com/pricing](https://zapier.com/pricing)). Langdock requires an administrator to
enable extra usage explicitly
([docs.langdock.com/administration/pricing](https://docs.langdock.com/administration/pricing)).
A pre-set choice is never a surprise. A default discovered on an invoice always is.

**Separate the platform meter from the model meter.** Relevance AI charges Actions for what
the platform did and passes model cost through as Vendor Credits, per third party reporting.
Make charges one credit per operation when you connect your own provider key and lets you pay
the provider yourself ([help.make.com/credits](https://help.make.com/credits)). This makes
bring your own key a clean subtraction rather than a special case, and it lets the platform
price hold steady when model prices move.

**Give a small allowance that refreshes on a rhythm people can feel.** Lovable grants 5 build
credits every day at midnight UTC
([docs.lovable.dev](https://docs.lovable.dev/introduction/plans-and-credits)). Manus grants a
free daily task ([help.manus.im](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them)).
A daily refill turns "I ran out" into "I will try again tomorrow", which is a far smaller
emotional event than a month long lockout, and it builds a daily habit.

**Gate abuse on lifetime spend rather than on identity checks.** OpenRouter raises the daily
free model limit from 50 requests to 1,000 once an account has purchased at least $10 of
credits at any point, and blocks free models entirely at a negative balance
([openrouter.ai/docs/api-reference/limits](https://openrouter.ai/docs/api-reference/limits)).
This is cheap to implement and hard to game, and it matters for us because our free tier will
be funded from a relationship we cannot afford to have farmed.

**Keep the history queryable by model and by run.** OpenRouter's activity view filters usage
by model, provider, and key. Cursor's removal of exactly this capability produced the loudest
complaint in the set. Detail behind the number is what makes a metered product feel honest.

## 10. Patterns worth avoiding

**Do not ship a unit whose price you cannot state.** Manus's admission that it cannot judge
credit consumption in advance is the root cause of its complaint volume. If we cannot answer
"what will this cost" before the run, we should not run it.

**Do not charge for retries of our own bugs.** The strongest single association in the
complaint data is between error loops and rage. Bolt's and Lovable's loops are the examples.
This is not primarily a billing problem, it is a billing problem created by a reliability
problem, and the billing rule is what determines whether the reliability problem also
destroys trust.

**Do not rename or redenominate an existing unit unless the new one is strictly more
generous, and prove that it is.** Cursor apologised and issued refunds
([cursor.com/blog/june-2025-pricing](https://cursor.com/blog/june-2025-pricing)). Make's
rename was executed carefully at a stated one to one ratio and still had to be explained in
detail ([help.make.com](https://help.make.com/introducing-credits-new-billing-unit-live-in-make)).
Windsurf simplified genuinely and was still accused of shrinking the allowance. Our lesson is
to pick the unit once, because changing it later costs goodwill even when the change is
correct.

**Do not remove money from the display.** Cursor's July 2026 change is the cleanest natural
experiment available, and the reaction was immediate and hostile
([forum.cursor.com](https://forum.cursor.com/t/usage-page-to-token-amount-what/167153)). The
underlying confusion Cursor was solving is real, and it is solved with a label, not a
deletion.

**Do not describe usage as a multiple of an unstated base.** Lindy's public pricing page says
Pro gives "3x more usage than Plus" without saying what Plus gives
([lindy.ai/pricing](https://www.lindy.ai/pricing)). Relevance AI's public pricing page no
longer states units at all ([relevanceai.com/pricing](https://relevanceai.com/pricing)). A
buyer who cannot estimate their bill either does not buy or buys resentfully.

**Do not run more than one balance pool with different rules.** Lovable runs daily credits
that expire nightly alongside monthly credits that roll over and then expire after two months
alongside top-ups valid for twelve. Windsurf ran two credit types and removed one. Manus runs
five pools with a defined consumption order. Each additional pool is a support burden and a
place for a customer to be surprised.

**Do not let the price depend on how hard the agent decided to work, without a cap.** Replit's
effort based pricing turned an agent capability upgrade into a silent price increase, with
users reporting five to twenty times their previous bills
([theregister.com](https://www.theregister.com/2025/09/18/replit_agent3_pricing/)). Our
harness has the same property, because we decide how many model calls a user message causes.

**Do not tie the refresh date to something the user cannot see.** Gumloop's anniversary based
refill is correct engineering and confusing product
([forum.gumloop.com](https://forum.gumloop.com/t/no-new-credits-for-the-month/1720)).

**Do not build the earning path on the assumption that others have proven it.** This deserves
its own note, because the founder's plan depends on it. Precedent for earning platform balance
through contribution is thin and mostly discontinued. Activepieces ran a rewards program from
2024 that paid contributors for templates, connectors, social posts, and referrals, with
templates reported at $0.40 each against a price of roughly $1 per 1,000 tasks; a community
member noted in August 2025 that the program was gone, and the company said it would launch
content creator and expert programs instead
([community.activepieces.com](https://community.activepieces.com/t/introducing-rewards/3870)).
n8n runs a verified creator program and a revenue sharing affiliate scheme rather than paying
contributors in platform balance, with payouts only above a €100 threshold
([n8n.io/affiliates](https://n8n.io/affiliates/),
[docs.n8n.io](https://docs.n8n.io/help-community/contributing/)). The pattern across the
category is that contribution is rewarded with status, distribution, and cash commission,
rather than with usage balance. That does not mean paying in credits is wrong for us. It does
mean we are ahead of the field rather than behind it, and we should design the earning path
expecting to iterate on it.

## 11. Recommendation for our unit and our display

### The unit

Use an abstract credit with a fixed and publicly stated conversion to money, and never change
that conversion.

The reasoning runs through the four unit families. A pure action count, such as "one agent
message", is the most legible option and it is what our prior work assumed. It fails now
because we are funding tool calls and sandbox compute as well as model calls, and because our
own harness decides how many model calls a message causes. Under an action count we absorb
every cost increase from our own capability improvements, which is exactly the exposure that
made Dust abandon flat pricing and that would make our funded free tier unbounded. Pure money
as the unit, as v0 and OpenRouter use, is honest and needs no teaching, but it publishes our
cost basis at a moment when our cost basis is unusual, and it makes a gift of balance look
like a gift of cash, which invites refund and transfer expectations. A seat with no meter does
not apply to a self service signup with no seat.

That leaves an abstract credit, and the whole risk of an abstract credit is the exchange rate.
The published evidence says so directly, from the pricing consultancy's comparison to airline
miles down to Cursor's apology. So remove that risk by construction. Fix the rate once, state
it on the pricing page, and treat it as immutable.

Concretely: **one credit equals one tenth of a United States cent, permanently.** A thousand
credits is one dollar. This scale is chosen so that a single agent message costs a whole
number of credits rather than a fraction. Our measured pattern is about 23,600 tokens of
replayed context per model call and two to three calls per user message. On a small model at
roughly $0.15 per million input tokens and $0.60 per million output tokens, a cached call
costs a small fraction of a cent and an uncached one costs a few tenths of a cent, so a user
message lands in the range of roughly 3 to 12 credits at this scale. On a large model the same
message might cost a few hundred credits. Both are numbers a person can hold in their head,
which is the entire point. These arithmetic estimates assume list prices that we should
replace with our real rates before publishing anything.

Price everything through one published formula with three inputs: model calls, converted from
tokens at the rate we publish per model; tool calls, at a small fixed price per call by
category, following the Dust pattern of zero for internal operations and a low fixed number
for external ones; and sandbox time, at a fixed price per minute. Publish the numbers. Then
publish four worked examples in the Lovable style, showing what a typical short conversation,
a typical tool using task, a long autonomous run, and a scheduled daily job actually cost.

Charge nothing for retries caused by our own errors, and say so on the pricing page in one
sentence. Given that our harness replays a large cached prefix on every call, we should also
state that we charge the cached price when the provider charges us the cached price, because
that is both true and a competitive advantage worth naming.

### The display

Do three things, in this order of importance.

Show the credit cost of each agent run inside the run, the way Dust shows it inside the
conversation. This is the highest value item in the entire document because it teaches the
unit without a single support ticket.

Show the balance as two numbers side by side: the credit count and its money equivalent at
the fixed rate, for example "4,120 credits, about $4.12 of usage". Cursor's July 2026 forum
thread is the evidence that removing the money view is read as dishonesty, and its staff
explanation is the evidence that the money view needs a label explaining that it is usage
value and not an amount owed. Two labelled numbers solve both problems at once.

Give a history view filtered by run, by model, and by category of consumption, with the raw
measurements visible behind each row. OpenRouter's activity view is the model to copy.

Add a per run credit cap that pauses and asks rather than continuing, following the pattern
Gumloop appears to use. Set a default for free balances so that no single run can drain a new
account's grant.

### The three funding sources

**Funded from the provider relationship.** Grant on signup, and refresh a small amount daily
rather than monthly, following Lovable and Manus. A daily refill converts exhaustion into
patience. Gate the size of the free allowance on something that costs an abuser money or
effort, following OpenRouter's rule that raises free limits once an account has ever purchased
credits. Never mention where the funding comes from in any public surface.

**Sold.** One published price per credit block, with the same fixed rate, so a purchase is
arithmetic rather than a decision. Purchased credits should not expire for at least twelve
months, which matches v0, Bolt, and Lovable, and is the least controversial expiry rule in the
set.

**Earned through contribution.** Because the precedent here is thin and mostly discontinued,
start manual. A human approves each award and it lands in the ledger as an ordinary grant with
a reason recorded. Do not build an automatic contribution scoring mechanism in the first
version. Do publish a fixed award schedule, so a contributor knows before writing the skill
what it is worth.

### What to write down now so we never have to migrate

The extensibility risk in a credit system is not the balance. It is that we store a credit
amount, later change how we compute it, and then cannot explain or restate history. Avoid this
by storing the measurement and the price separately on every entry.

Each debit should record the raw measured quantities, meaning the model identifier, input
tokens, cached input tokens, output tokens, tool name and category, and sandbox seconds. It
should record the identifier of the rate table used, the resulting credit amount, and the
reason. Each credit entry should record its origin, whether grant, purchase, or contribution
award, along with any expiry date and, for purchases, the payment reference.

With the measurements retained, we can add a second currency, restate a period, change model
rates without rewriting history, or answer a customer dispute exactly. Without them, the
credit amount is the only thing we have and every future question becomes a migration. This is
the one place where a small amount of extra work now removes a whole category of painful work
later.

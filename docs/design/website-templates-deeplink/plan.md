# Plan: website template deep-link, version 1

## The goal, in one paragraph

The marketing website shows cards for agent templates. A template is a named starter for an
agent, and today it is mostly a prompt: the instructions the agent begins with. When a
visitor clicks "Use this template" on the website, we want them to land in the product app,
sign up if they do not have an account, and then see the app create an agent from that
template's prompt. If the visitor is already signed in, the same thing happens right away
without a signup step. This should feel like the website's template gallery is the same
gallery the app already has, one click further out.

This first version is frontend only. It changes files in the website project and in the app,
and it changes no backend code and no API.

## What a visitor sees today

The website has a section of template cards. It lives in
`website/src/components/TemplateExplorer.tsx`. Every card's button points at the bare
address `https://cloud.agenta.ai/`, with nothing after it. Other calls to action on the site
do the same: `website/src/components/CtaBand.astro` and `website/src/components/SiteNav.astro`
both hardcode the same bare address. So when a visitor clicks any template card, the app opens
on its normal home page and cannot know which template the visitor picked. The template choice
is lost the moment they leave the website.

The app already knows how to turn a template into a running agent. It keeps a list of 28
templates in `web/oss/src/components/pages/agent-home/assets/templates.ts`. Each entry in that
list has a `key` (a short stable name such as `code-review-agent`), a `seedMessage` (the prompt
text), and display fields. When someone builds an agent from a template inside the app, the app
calls one function, `useCreateAgent` in
`web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts`. That function takes a name
and a seed message, creates the agent and its first version behind the scenes, opens the
agent's playground, and stashes the seed message for the new chat to use. This one function is
the whole "prompt becomes a working agent" path, and it already works.

So the gap is small. The app can already build an agent from a template. It just never hears,
from the website, which template the visitor wanted.

## Where new users actually land, and why it matters

The rest of this plan turns on one fact about the app, so it comes first. A brand-new user who
just signed up does not land on the agent home page. By default the app runs a flow called
playground-native onboarding: a first-time user (someone with no agents yet) is sent straight
to a project-scoped `/playground` route that opens an empty draft agent and lets them start
typing. Returning users, who already have agents, see the agent home page instead. You can
follow this in the code:
`web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/index.tsx` renders `OnboardingEntry`
when the onboarding flag is on, and it is on by default
(`PLAYGROUND_NATIVE_ONBOARDING` in
`web/oss/src/components/pages/agent-home/assets/constants.ts`); `OnboardingEntry`
(`web/oss/src/components/pages/agent-home/OnboardingEntry.tsx`) then redirects a first-time user
to `/playground` and shows the agent home page only to returning users.

The consequence sets the shape of the whole feature. The visitors this feature is built for are
exactly the ones who sign up, and they never pass through the agent home page. So the app cannot
consume the template only on the agent home page. It has to consume the template at whichever
first-run surface the user reaches, and by default that surface is the native onboarding
playground.

## Work already in flight next to this feature

Two other efforts touch the same files this plan touches. Anyone building this feature needs to
know they exist so the changes do not collide.

### The marketing website is itself new and unmerged

The `website/` project is recent and lives on its own branch called `marketing-website`. It is a
separate Astro project with its own build and its own deploy, described in `website/AGENTS.md`.
Two consequences follow. First, the website side of this feature must be built on top of that
branch, not on `main`, because the files it edits only exist there. Second, the website and the
app are deployed separately and share no runtime code. The only thing they can share is a plain
string in a link. That constraint shapes the "shared key space" decision below.

### A separate effort is redesigning the sign-in screens

There is a branch called `feat/signin-redesign` that reworks the authentication screens. The
app-side changes in this plan sit in the authentication and post-login routing code, the same
area that redesign edits. The two do not aim at the same lines: the redesign changes how the
sign-in screens look, and this plan adds a small amount of capture-and-consume logic around
them. Still, whoever builds this should coordinate with that redesign so the auth flow is only
reasoned about once. The safe order is to let the sign-in redesign land first, then add this
feature's logic on top of the settled auth flow.

## Why the obvious approach does not work

The app has an existing URL parameter named `redirectToPath`. At a glance it looks built for
exactly this: put a destination in the link, and after login the app sends you there. It is a
trap. The parameter is captured (`web/oss/src/state/url/auth.ts` builds `/auth?redirectToPath=...`
around line 389) but then thrown away. The authentication page at
`web/oss/src/pages/auth/[[...path]].tsx` destructures it out and drops it
(`const {redirectToPath, ...queries} = router.query`, around line 98), and the post-login
routing in `web/oss/src/hooks/usePostAuthRedirect.ts` always sends the user to their workspace
instead. Building on `redirectToPath` means first fixing why it is discarded, then modifying
every branch of the post-login routing and validating every internal destination. That is more
work and more risk than the feature needs, and it puts agent creation back inside the auth
routing we are trying to keep it out of.

## The technique that does work: copy the invite flow

The app already solves a harder version of this exact problem for workspace invitations. When
someone opens an invite link without an account, the app reads the invitation out of the URL,
saves it in the browser's local storage, lets the person go all the way through signup
(including the round-trips out to Google or another provider and back), and then, once they are
authenticated, reads the saved invitation and routes them to accept it. Local storage is a small
key-value store the browser keeps for a site. Unlike a URL, it survives navigations and provider
round-trips.

The relevant code is all in `web/oss/src/state/url/auth.ts`:

- `parseInviteFromUrl` (around line 34) reads the invitation fields out of the URL.
- `persistInviteToStorage` (around line 81) writes them to local storage under the key `invite`.
- `readInviteFromStorage` (around line 57) reads them back.
- `clearInvite` (around line 109) removes them from storage and, importantly, also strips the
  invite parameters out of the URL. It does the URL part because `syncAuthStateFromUrl` re-reads
  the URL on every navigation and would otherwise re-save the invitation from the still-present
  parameters, resurrecting it after we thought we cleared it.
- `syncAuthStateFromUrl` (around line 175) runs this capture on every navigation: it parses the
  URL, and if there is no invitation in the URL it falls back to the stored one.

This is the pattern to copy for templates. We capture a template key on arrival, save it, let
signup happen, and consume it once the visitor has a workspace and a project. The pattern is
proven in production, so we reuse its shape rather than invent a new one. One thing this plan
does differently is where the code lives. The invite functions sit directly inside `auth.ts`,
and if we add template logic there too, `auth.ts` slowly becomes a registry of unrelated
features. So the template capture, storage, time-to-live, validation, and clearing go in their
own small module, and `syncAuthStateFromUrl` only calls into it.

There is one more existing detail worth borrowing, and it decides what "after signup" should
feel like. The seed message the app hands to a new agent is carried by `agentFirstRunSeedAtom` in
`web/oss/src/components/AgentChatSlice/state/firstRunSeed.ts`. Its own code comment draws the
exact distinction this feature needs: a seed that comes from an explicit click inside the app is
marked to send on its own, so the agent starts running immediately, while a seed that merely
arrived with the page is not sent on its own and instead waits for the user. The comment states
the rule directly: never send a seed on its own when it merely arrived with a ready model. A
template arriving from the website is exactly the second case, which is why decision 2 below stages
the prompt behind a Start button rather than running it.

## The four decisions, and what was decided

Each decision lists the options and the reason for the choice. These were the only real choices
in version 1; the rest is careful wiring. All four are now settled, and the sections below record
the decision so that a reader building the feature has one place to look.

### Decision 1: which list of templates is the source of truth for keys

Decided: use the app's existing `templates.ts` registry. No backend catalog work in version 1.

For the website and the app to agree, they must share one vocabulary of template keys. There are
three candidate lists.

- The app's registry in `templates.ts`. It exists today, and each entry already maps a key to a
  seed message and straight into `useCreateAgent`. It works with no new code.
- The backend catalog. The backend already serves catalog entries under reserved names of the
  form `__ag__*` (through `fetchWorkflowCatalogTemplates`). It is the cleaner long-term home, but
  using it now means new backend and API work, which version 1 is trying to avoid.
- A brand-new shared list built for this feature. This is the most work and duplicates one of the
  two lists that already exist.

Why: it is the list that already turns a key into a running agent, so choosing it means the app
side is almost entirely wiring. The backend catalog is the right home later, when templates
become a marketplace, and the version 2 section describes moving to it.

The harder half of this decision is how the website, which shares no runtime code with the app,
learns the valid keys, and how a wrong key gets caught. The website keeps its own rich display
data for each card (it shows skills, tools, and a chosen harness, which the app registry does not
fully carry), so we are not trying to merge the two lists. The only thing that must match across
the boundary is the key string, and matching means two separate things: the key must exist in the
app registry, and it must name the template the card is actually about, not some other template
that happens to have a valid key. A test that only checks existence would pass a card that links
"KPI dashboard" to the `code-review-agent` key.

The workable arrangement, given the two projects deploy separately, has three parts:

- The website exposes its keys from a plain data file with no dependencies (a small JSON file, or
  a data module the card component reads), so the app's test can read the website's keys without
  importing website UI code.
- The app's co-located test in `templates.test.ts` asserts that every website key exists in the
  app registry and that no two website cards share a key.
- The continuous integration setup runs that test for both a website-only change and an app-only
  change. Today the unit-test workflow at `.github/workflows/12-check-unit-tests.yml` runs only
  when files under `web/**` change, so a website-only pull request that edits a key would not run
  the guard at all. Either add `website/**` to that workflow's triggers or add a dedicated job, so
  the guard cannot rot.

Existence and uniqueness are what a test can enforce mechanically. Whether a card points at the
right template is a review responsibility: the person adding a card confirms the key names the
template the card describes.

The continuous-integration guard is not the only defense, and it cannot be. The `template`
parameter arrives in a URL a visitor controls, so anyone can type `?template=anything` by hand,
and a stale key can outlive the card that produced it. The guard proves the checked-in website
keys are valid; it says nothing about a key that arrives at runtime. So the app also validates
every captured key at runtime, by exact lookup against the `templates.ts` registry, at the moment
it consumes the key. A key that is not an exact match for a registry entry is ignored and cleared
from storage in the same step, so it cannot linger and cannot be retried. The rule is strict:
an unknown or stale key never creates an agent and never falls back to another template. It is
treated as if no template had been requested at all. The test plan proves this directly, with a
case that feeds an unknown key through capture and consume and asserts that no agent is created
and no other template is substituted.

### Decision 2: after signup, run the prompt or let the user start it

Decided: show the prompt behind a Start button. The website-arrival path does not run the seed on
its own.

Once the agent is created, the app can either run the template's prompt immediately, so the agent
starts working the moment the playground opens, or hold the prompt and let the visitor start it.
It helps to know what the app actually renders in the second case. When a seed message is not set
to run on its own, the empty-chat screen
(`web/oss/src/components/AgentChatSlice/components/AgentChatEmptyState.tsx`) shows the prompt in a
"We'll start with" card above a Start button. So the choice is not "typed into the composer
versus not." It is "runs on arrival" versus "shown as the proposed first message with a Start
button the user presses."

- Running on arrival is the stronger demo. The visitor sees an agent already working.
- Showing the prompt behind a Start button is calmer. The visitor reads what they are about to
  run before it runs, and a brand-new account does not spend model tokens before the person has
  done anything.

Why: this matches the rule the app's own code already states in `firstRunSeedAtom`: a seed that
merely arrived with the page does not run on its own. Concretely, the website-arrival path calls
`useCreateAgent` with `autoSendSeed` set to false, which is the same setting several existing
in-app paths already use, and which makes the empty-chat screen render the prompt in a "We'll
start with" card above a Start button rather than sending it. We can revisit after watching real
signups.

One correction to a common assumption: the in-app template paths do not uniformly run their seed
on arrival. Only the home composer path sets the seed to run on its own; the other in-app template
paths already hold it. So the website-arrival behavior decided here is not a new special case;
it is the behavior most of the app already uses.

### Decision 3: cloud only, or self-hosted too, in version 1

Decided: cloud only. Every "Use this template" link opens the cloud app at cloud.agenta.ai and
nothing else. Version 1 adds no affordance for self-hosters, not even a copy-the-prompt button.
This is not the marketplace yet, and the honest move is to ship the cloud path first.

- Cloud only is simple and covers the common case.
- Self-hosted import needs the template to be fetchable by key from a public endpoint, which is
  backend work this version is not doing.

Why: this is deliberately the smallest thing that works. Building a self-hosted path now means
either a new public template endpoint or new website UI, and neither earns its keep before there
is a marketplace to serve.

How self-hosted would slot in later, so nothing here paints us into a corner. The design keeps the
key as the only thing that crosses the boundary between the website and whichever app opens it,
and it keeps the consume logic reading from a template source by key. Those two seams are exactly
what a self-hosted path reuses. In version 2 the template registry moves into the backend catalog
behind a public read-only "get template by key" endpoint (see the version 2 section). Once that
endpoint exists, a self-hosted Agenta can fetch the same template by the same key, and "Use this
template" can grow a second target ("import into your instance") next to "open in cloud", the way
n8n's cloud and self-hosted paths both read from one public template endpoint. Nothing in version
1 blocks that: the website link format already carries a bare key, and the app's consume path
already looks a template up by key rather than assuming the cloud registry is the only source. A
self-hosted deployment slots in by pointing at its own template host and reading the same shape.
No version 1 decision has to be undone to get there.

### Decision 4: where the app consumes the template

Decided: the shared-consume approach. A small piece of shared state holds the pending template key,
and each first-run surface reads it and consumes it at the point where that surface already creates
an agent. There is no dedicated handoff screen.

The app needs two new pieces: something that captures the template key on arrival and saves it,
and something that consumes it once the user has a workspace and a project.

The capture is straightforward. It reads the `template` parameter from the URL and saves it, and
it runs from inside `syncAuthStateFromUrl` in `web/oss/src/state/url/auth.ts`, right where the
invite capture runs, so both the invite and the template are read from the URL together. The saved
value carries a timestamp so it can expire.

The consume is the hard part, and the "where new users actually land" section above is why. There
is no single page every user passes through on the way to their first agent. A returning user
reaches the agent home page. A brand-new user, by default, reaches the native onboarding
playground at `/playground` instead. So the consume cannot live in one place and cannot live inside
the post-login routing in `usePostAuthRedirect.ts`, which sends new self-hosted-edition users, new
open-source users, and invited users to different destinations.

Two ways to handle more than one landing surface:

- One shared consume, read by every first-run surface. A small piece of shared state holds the
  pending template key. Both the native onboarding entry and the agent home page read it: the
  onboarding entry seeds its draft agent with the template's prompt, and the agent home page calls
  `useCreateAgent`. Each surface consumes the key at the point where it already creates an agent.
- One dedicated handoff. A first-run user carrying a template is routed to a single purpose-built
  screen that creates the agent from the template and then lands them in the playground, skipping
  the normal onboarding for that one case.

Why: shared-consume reuses each surface's existing agent-creation code rather than adding a
parallel creation path, and it degrades cleanly, because a surface that does not know about
templates simply never consumes one. A staff engineer defends this over the dedicated handoff on
two grounds. First, reuse: the handoff would duplicate `useCreateAgent` and the first-run seed
wiring in a screen built only for this one case, and that duplicate path would drift from the
in-app one over time. Second, blast radius: the handoff has to insert itself into the post-login
routing, the one area this plan is deliberately keeping template logic out of, whereas shared
state is read only by the surfaces that already create agents. The dedicated handoff is worth
reaching for only if the shared approach proves fiddly to keep correct across both surfaces, which
the requirements below are written to prevent.

This choice has to hold on both the United States and European clouds, because the cloud can
redirect a visitor to a regional address after they arrive, and that redirect is the one moment
this design is most likely to drop the template. Shared-consume survives it for a concrete reason.
The pending key does not live only in the shared state, which a full-page region redirect would
wipe along with the rest of the running app; it is captured from the URL into local storage, and
the region redirect preserves the query string (see the region-redirect requirement below), so the
capture simply runs again on the regional address and repopulates the shared state there. The
consume then happens on the address the user actually ends up on. Whichever approach is chosen, the
create must not fire until the workspace and project are real, and it must fire at most once. Those
two requirements are strict enough to need their own section.

## Requirements the consume step must meet

These are not optional polish. Each one comes from a specific way the current app can misbehave,
and the design has to answer all of them before implementation.

### Do not create until the workspace and project are ready

The app has a helper, `waitForWorkspaceContext` in
`web/oss/src/state/url/postLoginRedirect.ts`, that waits for a workspace and project to resolve.
It is not a guarantee. It returns after a four-second timeout even if the context is still
incomplete, and it can fall back to a project that does not belong to the current workspace. The
post-signup flow even calls it without requiring a project id at all. So the consume step must not
treat "the helper returned" as "ready to create." It must confirm a real current workspace id and
a real current project id before it calls `useCreateAgent`, and it must wait or retry if either is
missing. Creating too early risks putting the new agent in the wrong project or in no project.

### Create at most once

`useCreateAgent` has a re-entry guard, `inFlightRef`, but it only protects one instance of the
hook from overlapping calls. It does not protect against React mounting an effect twice in
development, against two different surfaces both trying to consume, or against a second browser
tab. So the pending template needs its own claim step that is independent of any one component:
before creating, mark the key as claimed in a place all consumers can see, and only the consumer
that wins the claim creates.

The honest engineering point, which the review raised and this plan accepts, is that local storage
alone cannot make this guarantee. Local storage has no atomic compare-and-set, so two tabs can both
read the key as unclaimed, both write "claimed", and both create. The design answers this rather
than assuming it away, and it does so with the browser's Web Locks API, which is the standard tool
for exactly this. The claim runs inside `navigator.locks.request` on a lock name derived from the
template key, and the whole read-claim-write sequence happens while the lock is held, so at most one
consumer across all same-origin tabs can observe the key unclaimed and move it to claimed. This is a
real mutual-exclusion primitive, not a hand-rolled flag, and it is available in every browser the
cloud app supports. The plan chooses the Web Locks path rather than weakening to best-effort because
the mechanism is small, standard, and removes the duplicate-tab race outright instead of tolerating
it.

The Web Locks API is same-origin only, and it does not exist in a few older or unusual runtimes, so
the design has a documented fallback: when `navigator.locks` is absent, the claim degrades to a
best-effort local-storage compare-and-set (read, and if unclaimed write claimed), and the plan is
explicit that in that narrow fallback case the guarantee softens from at-most-once to best-effort.
Even in the fallback, the single-tab and same-instance races are still covered by `inFlightRef` and
by claiming before the asynchronous create begins; only the genuinely-simultaneous two-tab case can
slip through, and its worst outcome is one duplicate draft agent the user can delete, never a wrong
workspace or a charge. The test plan covers the duplicate-tab case directly under both the Web Locks
path and the fallback.

Clearing the key before the create means a failed create loses the intent; clearing it after the
create risks a duplicate if the app crashes mid-create. At-most-once, with the key claimed under the
lock before the asynchronous create begins, is the safer default; exactly-once is not something a
frontend-only version can promise, and the plan does not pretend otherwise.

### Survive the region redirect

Local storage belongs to one exact web address. The cloud app can redirect a visitor from
`cloud.agenta.ai` to a regional address such as `eu.cloud.agenta.ai` or `us.cloud.agenta.ai`, and
a key saved under the first address is not visible under the second. The redirect does preserve the
query string (`buildSwitchUrl` in `web/oss/src/lib/helpers/region.ts` keeps the path, query, and
fragment), so the `template` parameter is still in the URL after the switch. The capture therefore
has to run again on the regional address, reading the parameter back out of the URL and saving it
under the address the user actually ends up on.

### What happens when an invitation and a template arrive together

A link could in principle carry both an invitation and a template. The rule is that the invitation
wins the routing, because the person is joining a specific workspace, and the template stays saved
and is consumed once they are inside a workspace with a project. The template is deliberately the
lower-priority intent: it is account-agnostic, since it is only a prompt, so it can be consumed in
whatever workspace the person actually lands in, whereas the invitation is account-specific and
must route.

The case the review asked to pin down is the wrong-account collision: the invitation is for one
account, and the person signs in with, or creates, a different account. The decision is that the
template stays pending across that mismatch and is never discarded because the invitation did not
apply. Concretely, three outcomes are defined, and each is a state transition the tests assert:

- The invitation matches the signed-in account. The invitation is accepted and routes the person
  into its workspace. The template stays pending until a workspace and project are confirmed, then
  is consumed there. End state: invitation accepted, template consumed, both cleared.
- The invitation fails or does not apply for a reason other than account mismatch (for example it
  is expired or already used). The person continues to their own default workspace by the normal
  routing. The template stays pending and is consumed on the first-run surface they reach. End
  state: invitation cleared as failed, template consumed in the person's own workspace.
- The invitation is for a different account than the one the person signs in with. The invitation
  is discarded, following the app's existing invite behavior for a mismatched account, and the app
  does not force an account switch for the sake of the template. The template is not tied to that
  invitation, so it stays pending and is consumed on the first-run surface of the account the
  person actually used. End state: invitation discarded, template consumed in the person's own
  workspace.

In every branch the template outlives a failed or wrong-account invitation rather than being thrown
away with it, and it is consumed exactly where the person ends up, never in a workspace they did not
land in. The test plan covers all three transitions.

### Set the expiry from the moment of capture

The saved key carries a timestamp so a forgotten key cannot create an agent days later. Two rules
keep the expiry honest. Stamp the timestamp once, when the key is first captured, not on every
navigation that re-reads the URL, or the key would never age. And give it enough time to cover a
real signup: email verification and a provider round-trip can take several minutes, so a two-minute
limit is too short. Once a key is past its expiry, delete it rather than consume it.

### Seed the onboarding agent through the non-auto-send first-run state

"Seed the draft agent" is too loose to build from, because the same registry documents its
`seedMessage` as auto-sent the moment a ready playground opens, and this feature requires the exact
opposite for website arrivals. So the seed path is specified precisely rather than left to
interpretation. The template's prompt is written into the first-run seed state,
`agentFirstRunSeedAtom` in
`web/oss/src/components/AgentChatSlice/state/firstRunSeed.ts`, with its send-on-its-own flag set to
false, which is the identical state `useCreateAgent` produces when it is called with `autoSendSeed`
false. That flag being false is what makes the empty-chat screen
(`web/oss/src/components/AgentChatSlice/components/AgentChatEmptyState.tsx`) render the prompt in the
"We'll start with" card above a Start button instead of sending it. The rule for both first-run
surfaces is the same: never set the send-on-its-own flag for a template that merely arrived with the
page. The agent home page reaches this state through `useCreateAgent({..., autoSendSeed: false})`;
the native onboarding entry reaches the same state for the draft agent it opens. Neither path
auto-sends. The end-to-end test asserts this exact card-and-Start-button state on the native
onboarding surface, which is the surface a brand-new signup actually reaches.

### Read storage on the client only, and update the URL through the router

The app renders on the server first (Next.js), where there is no local storage, so the capture and
consume must read storage only inside client-side effects, never during render. When the consume
strips the `template` parameter out of the URL, it should do so through a coordinated router update
rather than a bare `history.replaceState`, so the framework's own record of the URL does not fall
out of step with the address bar.

### Record what happened

Add analytics events across the flow so we can see whether it works: the click on the website, the
capture on arrival, the claim, a successful create, a failed create, and an expiry. Tag each event
with the template key and the fact that the source was the website. Without these we cannot tell a
working feature from a silently broken one.

## What version 1 builds

The scope is deliberately narrow. Version 1 is:

- Website cards that carry a template key. Each template card's link becomes
  `https://cloud.agenta.ai/?template=<key>` instead of the bare address, and the keys come from a
  plain data file the app's test can read.
- App-side capture of that key, saved in local storage with a capture-time expiry, in its own small
  module called from `syncAuthStateFromUrl`, and run again after a region redirect.
- App-side consume of the key at the first-run surface the user reaches (the native onboarding
  playground for new users, the agent home page for returning users), gated on a confirmed
  workspace and project, claimed so it fires at most once, creating the agent with the template's
  prompt held behind a Start button.
- One shared vocabulary of keys, kept honest by a test that every website key exists in and is
  unique against the app registry, running in continuous integration for both website-only and
  app-only changes.

It is entirely frontend. It adds no backend code and no API. It targets the cloud app only.

## What version 1 does not build, and where it goes later

The following are out of scope for version 1. They form the direction toward a template
marketplace, and naming them here keeps version 1 from accidentally growing to meet them.

- Moving the template list to the backend. Later, the template registry moves into the existing
  backend catalog behind a public read-only endpoint: metadata for the website to render cards
  from, and a "get template by key" for creating the agent. At that point the website, the app, and
  any future surface all read one source, and the cross-project key check in decision 1 disappears.
- Self-hosted import. Once that endpoint exists, a self-hosted Agenta can fetch a template by key,
  and "Use this template" can offer both "open in cloud" and "import into your instance", the way
  n8n does. A setting that points at the template host keeps a company's private template library
  possible.
- A submission and review marketplace, with creator pages, categories, and moderation. Because our
  templates are prompts and configuration rather than arbitrary code, and because templates never
  carry secrets, the review surface is small. The no-secrets rule holds from day one: a template is
  a prompt and configuration, never an API key or a connected account.

## Build outline, step by step

The order below lets each step be verified before the next. It assumes the sign-in redesign has
landed and the website branch is the base for the website changes.

1. **Give the website cards a key.** In `website/src/components/TemplateExplorer.tsx`, add a key to
   each template, sourced from a plain data file with no dependencies so the app's test can read it.
   Change each card's link from the bare `https://cloud.agenta.ai/` to
   `https://cloud.agenta.ai/?template=<key>`. Leave the general "start building" buttons
   (`CtaBand.astro`, `SiteNav.astro`) as they are; they are not template picks.

2. **Add the key guard and run it in continuous integration.** Add a test near the app registry
   (`web/oss/src/components/pages/agent-home/assets/templates.test.ts` is the co-located model) that
   reads the website's keys and asserts each one exists in the app registry and no two website cards
   share a key. Then make the unit-test workflow at `.github/workflows/12-check-unit-tests.yml` run
   this test when either `web/**` or `website/**` changes, so a website-only pull request cannot
   drift the keys unchecked.

3. **Add the capture module in the app.** Create a small module, separate from `auth.ts`, that reads
   the `template` parameter from the URL, saves it to local storage under a new key such as
   `pendingTemplate` with a capture-time timestamp, reads it back, and clears it (removing both the
   storage entry and the `template` URL parameter, the way `clearInvite` strips its parameters). Call
   the capture from inside `syncAuthStateFromUrl` in `web/oss/src/state/url/auth.ts`, next to the
   invite capture. Make sure the capture also runs on the regional address after a region redirect,
   since the parameter survives the redirect in the query string but the stored key does not.

4. **Add the consume at the first-run surfaces.** Put the pending key in a small piece of shared
   state. First validate the key by exact lookup against the `templates.ts` registry; an unknown or
   stale key is ignored and cleared here and never creates an agent. Have the native onboarding entry
   (`web/oss/src/components/pages/agent-home/OnboardingEntry.tsx` and the onboarding playground it
   leads to) write the template's prompt into `agentFirstRunSeedAtom` with the send-on-its-own flag
   false, and have the agent home page (`web/oss/src/components/pages/agent-home/`) call
   `useCreateAgent({name, seedMessage, autoSendSeed: false})`. Both read the same key. Before either
   creates, confirm a real workspace and project (see the requirements section), claim the key under
   a Web Locks lock so only one consumer creates, and clear it. Hold the prompt behind a Start button
   rather than running it on arrival.

5. **Handle the edge cases from the requirements section.** Implement the region recapture, the
   at-most-once claim, the capture-time expiry with a limit long enough for real signup, the
   invitation-and-template precedence, the client-only storage reads, the router-coordinated URL
   cleanup, and the analytics events. Each of these has a concrete failure it prevents; none is
   optional.

## Test plan

Two layers of test, matching the two kinds of logic.

**Unit tests for the capture-and-consume logic.** These do not need a browser and run in the app's
existing unit-test setup (the co-located `*.test.ts` files that sit next to their source, as
`templates.test.ts` does). Cover:

- Reading the `template` parameter out of a URL returns the key, and a URL without it returns
  nothing.
- Saving then reading the key round-trips through local storage.
- Clearing removes the key from storage and removes the `template` parameter from the URL, so a
  following read of the URL does not bring it back. This is the resurrection guard the invite flow
  needs, and this feature needs it for the same reason.
- A key past its expiry reads back as absent, and the expiry is measured from the capture time, not
  reset on each read.
- An unknown or stale key is ignored and cleared: a captured key that is not an exact match for a
  registry entry creates no agent, substitutes no other template, and is removed from storage so it
  cannot be retried. This is the runtime validation from decision 1, tested directly.
- The claim step lets only the first caller create: a second call after a claim does nothing. This
  runs under the Web Locks path and, separately, under the local-storage fallback used when
  `navigator.locks` is absent.
- The duplicate-tab case: two consumers racing on the same pending key create at most one agent
  under the Web Locks path, and the best-effort fallback is exercised too so its weaker guarantee is
  visible in the test rather than assumed.
- The invitation-and-template transitions from the requirements section: invitation accepted with
  the template consumed in that workspace; invitation failed with the template consumed in the
  person's own workspace; wrong-account invitation discarded with the template still consumed in the
  person's own workspace.
- The key guard from build step 2: every website template key exists in the app registry and is
  unique.

**One end-to-end happy path.** The app has Playwright tests under `web/oss/tests/playwright`. Add
one test that walks the whole flow for a signed-out visitor: open the app at `/?template=<key>` for
a known key, go through signup, and assert that the visitor lands on the native onboarding surface
with the template's prompt shown in the "We'll start with" card above a Start button, the send
button not yet pressed, and no assistant response present, which together prove the seed was staged
and not auto-sent. The test drives the exact non-auto-send native-onboarding path from the
requirements section, and pressing Start is what runs the prompt. Because a new user lands on the
native onboarding playground rather than the agent home page, this test also proves the consume
fires on the surface new users actually reach, which is the single most important thing to get
right.

## Summary of decisions

- Source of truth for keys in version 1: the app's `templates.ts` registry, with a test that keeps
  the website's keys existing and unique against it, running in continuous integration for both
  projects, and with a runtime exact-match check that ignores and clears any unknown or stale key.
- After signup: show the prompt behind a Start button for website arrivals, staged through the
  first-run seed state with its send-on-its-own flag false, the same setting most in-app template
  paths already use.
- Reach: cloud only in version 1, with no self-hoster affordance, and a template source read by key
  so a self-hosted path can slot in behind the version 2 backend endpoint without undoing anything.
- Capture the key from `syncAuthStateFromUrl` into its own module, re-run after a region redirect so
  it works on both the United States and European clouds; consume it at the first-run surface the
  user reaches, gated on a confirmed workspace and project and claimed under a Web Locks lock so it
  fires at most once, not inside the post-login routing.

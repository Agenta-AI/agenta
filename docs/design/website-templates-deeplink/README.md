# Website template deep-link, version 1

This folder holds the plan for one feature: a visitor clicks "Use this template" on a
template card on the marketing website, lands in the product app, signs up if they need an
account, and the app creates an agent from that template's prompt. This first version is
frontend only. It does not change the backend or any API.

## What each file answers

- `README.md` (this file): what the feature is, the words it uses, and where to start.
- `plan.md`: the whole plan. It describes what a visitor sees today, why the obvious
  approach does not work, the four decisions and why each went the way it did, what version 1
  builds and what it leaves out, a step-by-step build outline with file paths, and the
  tests to write.

Read `plan.md` top to bottom. It is written to be understood without reading the code
first.

## Words this plan uses

A few terms come up throughout. Each one is defined again where it first appears in
`plan.md`; this list is a quick reference.

- **The website**: the marketing site at agenta.ai. It lives in the `website/` folder and
  is a separate Astro project, built and deployed on its own, independent of the product
  app.
- **The app**: the product at cloud.agenta.ai. It lives in the `web/` folder and is a
  Next.js application.
- **Template**: a named starter for an agent. Today a template is mostly a prompt (the
  instructions the agent starts with) plus some display text. The app already keeps a list
  of 28 of these.
- **Template key**: a short, stable string that names one template, for example
  `code-review-agent`. The key is the only piece of information the website hands to the
  app.
- **Seed message**: the prompt the app hands to a freshly created agent as its proposed first
  message. The app already has one seed message per template. Depending on how the agent was
  created, the app either runs the seed on its own or shows it behind a Start button.
- **The invite flow**: the existing feature where a link with a workspace invitation in it
  survives a full signup and then routes the new member to the right place. This plan
  copies that flow's technique.
- **The agent home page**: the page inside the app that lists a user's agents and shows the
  in-app template gallery. Returning users land here.
- **The native onboarding playground**: the first-run experience for a brand-new user. Instead
  of the agent home page, a user with no agents yet is sent to a `/playground` route that opens
  an empty draft agent. This is on by default, and it is why the plan cannot rely on the agent
  home page as the one place every user passes through. The plan covers this in its section
  "Where new users actually land, and why it matters"; read that section before the decisions,
  because the rest builds on it.

## Status

This is a design proposal, and the four decisions it raised are settled and recorded in
`plan.md`. The app side is built in a separate pull request. The website side, which adds the
template key to each card link, ships on its own afterward.

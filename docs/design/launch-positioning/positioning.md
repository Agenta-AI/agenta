# Agenta 2.0: positioning, GTM, and launch plan

Canonical working doc for the agent pivot. It states what we think makes sense, then
lays out the experiments and campaigns to test it. Status: **in progress**, first launch
target Wednesday. The launch is not one day. It is a set of repeatable actions we run and
measure over the next three months.

---

## 1. The bet

We restructure the platform around agents. You create an agent, connect it to your
integrations, trigger it or chat with it, and run it on your own subscription. The MVP
leads with **automation**, not chat, because chat is not good enough yet.

The aha moment: you do a task a few times by hand, then turn it into an automation.

The product the user feels: **your team can build its own agents, easily, by talking.**
We take Gumloop's core promise as-is and say it more simply. Their site indexes as an
"AI automation platform," but their message is about agents and about letting a team
build them. That promise is strong. We do not overcomplicate it.

## 2. The decision (what we lead with)

**Beachhead: technical people first, who bring it into their organization.** Not the
non-technical end user yet, and not the privacy-bound enterprise. A technical person
already builds by talking (they use Claude Code), so the build-by-chatting flow lands
without teaching. We then ride them inward to their non-technical teammates.

Specifically, in order, starting right after our friends:

- Bootstrapped founders and founders
- Freelancers and consultants who live in job descriptions on Upwork and Fiverr, and
  who can build, host, and maintain agents for clients
- Technical and semi-technical people in startups (engineering, research, product,
  security)
- Geography weighted to emerging markets where cost and self-hosting both resonate:
  India, Indonesia, Brazil, China, Japan, Korea

**Technical vs non-technical is the single biggest thing to test.** We lead technical
because it is the safer first bet, and we test the rest in public.

The freelancer is a partner, not just a user: they create and maintain agents for many
clients, they will self-host, and they do good work. Test them on purpose.

## 3. Messaging and value props

Two messages carry everything:

1. **You can automate a lot of your work with agents.** This is table stakes. Agenta
   does it too.
2. **We changed how you create an agent.** You build it by talking. It is easy, with no
   friction. You can start from Slack or from one prompt. And it improves itself from
   your feedback.

The story we repeat everywhere: **easy to create, no friction, and it improves.** When
the agent makes a mistake, you tell it, and the next version does not repeat it. Over
time it gets better. If it needs a tool, it tells you which one. For technical audiences,
name the mechanism: continual learning, self-learning, reflection, recursion. We deliver
this through a UI, across time, not in one shot.

**The self-hosting and ownership USPs, ranked by how much they actually land:**

- Use your own coding subscription to power it. **Very strong.**
- Run it locally, run a hosted version, or run it in the cloud, and move it between them.
  **Very strong.**
- Self-host your own models. **Strong.**
- Use many harnesses and providers. **Interesting, and more powerful than it sounds.**
- Hundreds of tools and integrations, available from the start, usable from Slack on
  your own data. **Strong.**
- Security and "your data stays with you." **Depends on the person.** Some have heard it
  before. Touch it, do not lead with it.

**Voice.** Have a strong, decisive opinion. Say what you think about the future of work
and automation, because you have thought hard about it. Like things and dislike things
out loud. Boring and wishy-washy is the only real failure. Any attention is good as long
as it is legal. The risk is being ignored, not being divisive.

## 4. Artifacts (the evidence)

Belief comes from showing, not claiming. Videos especially. Build these first:

- **Template and use-case gallery.** The single most important first artifact.
- **Use-case videos.** "Here are the agents I built, by chatting." And: "Watch me chat
  with the agent, here is what it says, here is the end result."
- **Self-hosting tutorials.** How to host the platform. How to use your Llama, DeepSeek,
  or the OpenCode harness to create agents. One short video per setup.
- **The initial website.**
- **The initial GitHub** with reusable artifacts, templates, and issues.
- **Clean integrations**, made usable within the week.

Possible co-marketing: get a model maker (Zed, DeepSeek) to ship an integration and
share it. Every model or tool we add is "an integration," and the story repeats.

## 5. Channels and the funnel

Distribution is most of the work, more than the product. Build **our own channels** and
grow real involvement in each: our Twitter, our LinkedIn, our YouTube, our subreddit,
with Mahmoud as the face.

- **Reddit first.** The obvious place to launch. Research which subreddits matter, what
  they talk about, and how each works, then post the launcher.
- **GitHub.** Open many issues, attract contributors, and turn contributors into reach.
  Ask them to create templates and share them in blog posts that link back.
- **Community and events.** Community feeling matters more than people think (OpenClaw,
  Langfuse grew by talking to people). It beats YouTube on trust. Leverage being in
  Europe: get invited to meetups, speak about Agenta, be the face. Find niche people in
  Discord, on TikTok, and in China.
- **YouTube** for use-case and self-hosting videos, and as a top-of-funnel ad surface.
- **Influencers.** Find the right, cheap ones. Pay on performance with attribution:
  "drive me 100 signups, I pay you X." Judge by signups, not stars. Keep a budget on the
  side (order of $10k) and cut other costs to fund it.
- **Ads.** Twitter ads targeting followers of self-hosting accounts (Ollama and similar)
  look reasonable. YouTube ads against relevant videos look reasonable. Google search
  ads are likely too expensive. Reddit ads and retargeting are weak.
- **Outreach.** Free and scalable. Social-monitor for people discussing the problem, then
  message them with the angle that fits (self-learning, self-host your models, or
  open-source alternative to Gumloop).

## 6. Campaigns (the experiments to run)

Run **one or two experiments a week.** For each: measure spend, talk to the users, learn,
and iterate fast. Start simple, go larger, and add a new campaign almost daily. Each story
below is a campaign with an end result and a to-do list.

| Campaign | The angle | End result we want | To-dos |
| --- | --- | --- | --- |
| **Reddit launch** | Open-source, self-hosted agents you build by talking | First 5-10 users; signal on which subreddit and message work | Research subreddits; write the launcher post; ship website + gallery first |
| **Self-hosting videos** | "Host the platform and run agents on your own model/subscription" | YouTube watch-through and self-host installs | Record host + Llama/DeepSeek/OpenCode setups; one video each |
| **Use-case videos** | "Watch me build this agent by chatting" | Belief and template installs | Pick high-value use cases; record build + end result |
| **GitHub contributor program** | "Build templates and skills, get known" | Contributors who bring their own audience | Open issues; lighthearted points-for-swag contest; templates marketplace |
| **Integration outreach** | "Native integration with Agenta to create agents" | Partner blog posts and shares, smallest companies first | Agentically find tools; check feasibility; record video; pitch the right person |
| **Influencer signups** | The fitting USP per influencer | Paid signups with attribution | Shortlist cheap, on-topic creators; set up attribution; pay per 100 signups |
| **Free-credits hook** | Star + follow + link earns credits (Firecrawl model) | Stars, follows, first usage | Wire credits from Google/Daytona; align with API cost; gate on simple actions |
| **Outreach + social monitoring** | "You talked about this, look at what we built" | Replies, signups, conversations | Build the list; monitor mentions; send the matched-angle message |
| **Public agent output** | Agent results carry our name | Organic reach in PRs and comments | Ship the PR/comment output that names Agenta |

## 7. Build systems, not one-offs

Do not do anything once. Use agents and Agenta to build a **system** for each repeatable
activity, and make videos about building them (dogfooding becomes content):

- A system for user outreach
- A system for creating templates
- A system for creating videos
- A pre-release QA system that runs overnight and at the start of the day, on a cheap
  platform (likely Daytona), so we keep product quality high without burning time on
  manual QA

Feed the loop back: read the traces users send to Agenta as our own signal, and add a
feedback endpoint (on GitHub or elsewhere) so our skills can act on it.

## 8. Product roadmap (next three months)

Core: **sessions, files, mobile, the Slack app.** Plus quality-of-life work and the
standard features. Then remote MCPs and integrations, which pull in new harnesses and new
providers. The hard part is keeping quality high while spending almost no time on manual
QA, which the QA system above is meant to solve.

UI principle: surface the simple flow, hide the complex one. Keep tracing, sessions, and
automation logic under an "advanced" section, and make the main flow interesting. Use
roles: a non-developer role sees chat and the business view, not the automation logic.
Plan for a business mode and a developer mode, with developer mode as its own story.

## 9. Operating model and focus

- Mahmoud spends **80% on go-to-market and talking to users**, informing product but not
  running it day to day. Trust JP and Arda for the high-level technical work. Mahmoud
  fixes UX/UI and holds taste.
- The near-term goal is the **first 5-10 users, as fast as possible.**
- High urgency, three-month window. Cut costs and reduce accounts to fund influencers and
  ads; founder salary is the defensible lever.

## 10. The endgame: signals and funding

We optimize for a raise. The story: Agenta is three years old, the old thing was not
working, we pivoted, and after the pivot it is working. We launch Agenta 2.0 in July.
VCs already know the name, so returning with a pivot and real traction is fundable.

The signals VCs read: **GitHub stars, and how much developers and engineers talk about
us.** Get growth and conversation right, and funding follows. Google credits extend the
runway, revenue extends it more, and the signals raise the round.

## 11. First steps

1. Research Reddit: which subreddits, what they discuss, how each works.
2. Produce the first artifacts: website, GitHub, template gallery, use-case and
   self-hosting videos.
3. Clean up integrations into something usable this week.
4. Launch on Reddit, measure, talk to users, and iterate into the next campaign.

## Open threads

- Confirm the technical-first beachhead, or run technical and freelancer in parallel from
  week one.
- Decide the very first campaign and its owner.
- Pick which systems (outreach, templates, videos, QA) we build first with Agenta.

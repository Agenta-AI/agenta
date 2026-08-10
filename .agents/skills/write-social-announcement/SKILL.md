# Write Social Media Announcements

This skill creates authentic social media announcements for LinkedIn, Twitter/X, and Slack that avoid common AI writing patterns.

## Writing Guidelines

### Core Principles

1. **Write like a human, not a press release**
2. **Be specific, not generic**
3. **State facts directly without inflating their importance**
4. **Vary your openings** - Don't start every post with "We just shipped"

### Words and Phrases to NEVER Use

These words are statistical markers of AI-generated text. Avoid them completely:

**Significance words:**
- testament, pivotal, crucial, vital, key (as adjective), groundbreaking
- underscores, highlights, emphasizes, showcases, exemplifies
- landscape (abstract), tapestry (abstract), realm, beacon
- indelible mark, focal point, deeply rooted

**Transition/filler words:**
- Additionally (especially at start of sentence)
- Furthermore, Moreover
- In summary, In conclusion, Overall
- It's important to note/remember/consider

**Puffery words:**
- vibrant, rich (figurative), profound, renowned
- cutting-edge, revolutionary, game-changing
- seamless, robust, comprehensive, holistic

**Action verbs that sound corporate:**
- delve, garner, foster, cultivate, leverage
- enhance, optimize, streamline, empower
- align with, resonate with

**Generic praise phrases:**
- commitment to excellence/quality/innovation
- dedication to [abstract noun]
- passion for [thing]

### Sentence Patterns to AVOID

**1. Superficial "-ing" analyses at end of sentences**

❌ "We added cost tracking, helping teams make better decisions."
❌ "The new filter reduces noise, enabling faster debugging."

✅ "We added cost tracking. Now you can see exactly what each request costs."
✅ "The new filter reduces noise. Debugging is faster."

**2. "Not only... but also" and negative parallelisms**

❌ "It's not just about speed, it's about reliability."
❌ "Not only does it track costs, but it also shows token usage."

✅ "It's fast and reliable."
✅ "It tracks costs and shows token usage."

**3. Rule of three (adjective, adjective, adjective)**

❌ "A fast, reliable, and scalable solution."
❌ "Clean, modern, and intuitive interface."

✅ "It's fast." (just say the most important thing)

**4. Rhetorical questions followed by answers**

❌ "Working with large test sets? Collapse them."
❌ "Tired of switching tabs? Now you don't have to."

✅ "You can collapse large test sets."
✅ "Costs show in the dropdown. No tab switching."

**5. "Small changes, but they add up" type closings**

❌ "Small changes, but they add up when you're testing prompts all day."
❌ "Little things that make a big difference."

✅ (Just end. Don't summarize or reflect on the importance.)

**6. Overuse of em dashes for dramatic effect**

❌ "Provider costs — right in the dropdown — so you don't have to switch tabs."

✅ "Provider costs show in the dropdown."

### What TO Do

**Be direct:**
- "You can now see costs in the dropdown."
- "Evaluations run from the Playground."
- "Test cases collapse."

**Be specific:**
- "Cost per million tokens shows next to each model."
- Not: "Cost information is now more accessible."

**Use simple verbs:**
- "is" instead of "serves as"
- "has" instead of "boasts" or "features"
- "shows" instead of "showcases"

**Vary sentence length:**
- Mix short punchy sentences with longer ones
- Don't make every sentence the same structure

**End without summarizing:**
- Don't wrap up with "these improvements help teams..."
- Just stop after the last fact

### Platform-Specific Guidelines

#### LinkedIn

**Format:**
- 3-4 short paragraphs max
- One code snippet if relevant (optional)
- Link at the end
- No hashtags (LinkedIn algorithm doesn't favor them anymore)

**Tone:**
- Conversational but professional
- First person ("We shipped" or "I added")
- Explain what changed and why it matters

**Opening variations (rotate these, don't always use the same one):**
- "[Feature] is live in [Product]."
- "Three updates to [Product] this week:"
- "New in [Product]: [feature]."
- "[Problem statement]. Fixed that."
- Start with the most interesting detail

#### Twitter/X

**Format:**
- Two tweets max: announcement + link
- First tweet: what shipped + key benefit (under 280 chars)
- Second tweet: "Check it out:" + link

**Tone:**
- Casual, direct
- No thread unless it's a major release

#### Slack

**Community (#announcements):**
- Short, user-focused
- One code snippet if it helps
- Bullet points OK here
- Link to changelog

**Internal (#product-updates):**
- Bullet points with metrics
- Note any manual TODOs
- Link to changelog

### Examples

**LinkedIn - Good:**
```
Three Playground updates shipped today.

Model costs show in the dropdown now. You see the price per million tokens right when selecting a model.

You can run evaluations without leaving the Playground. Hit evaluate, pick your test set, and it runs with your current config.

Test cases collapse. Useful when you have 50 of them and need to find a specific one.

https://agenta.ai/docs/changelog/playground-ux-improvements
```

**LinkedIn - Bad (AI patterns):**
```
We just shipped three quality-of-life improvements to the Agenta Playground.

**Provider costs upfront.** You can now see the cost per million tokens directly in the model selection dropdown — helping you make informed decisions about which model to use.

**Evaluations from the Playground.** Start an evaluation run without leaving the Playground, keeping you in flow when iterating on prompts.

**Collapsible test cases.** Working with large test sets? Collapse completed test cases to focus on what matters.

Small changes, but they add up when you're testing prompts all day.
```

Problems with the bad version:
- "quality-of-life improvements" - generic puffery
- "helping you make informed decisions" - superficial -ing analysis
- "keeping you in flow" - superficial -ing analysis
- "Working with large test sets?" - rhetorical question
- "focus on what matters" - cliché
- "Small changes, but they add up" - AI closing pattern
- Overuse of em dashes
- Bold headers with periods (feels like a list, not prose)

**Twitter - Good:**
```
Tweet 1:
Three Playground updates in Agenta:
- Model costs visible in dropdown
- Run evaluations without leaving Playground
- Collapsible test cases

Tweet 2:
Changelog: [link]
```

**Twitter - Bad:**
```
We just shipped three quality-of-life improvements! 🚀

The Playground now shows provider costs, lets you run evaluations directly, and supports collapsible test cases.

Small UX wins that add up. Check it out 👇
```

Problems: emoji, "quality-of-life improvements", "Small UX wins that add up"

### Self-Check Before Posting

Ask yourself:
1. Would a tired engineer actually write this at 11pm?
2. Does every sentence add new information?
3. Did I use any words from the "never use" list?
4. Did I end with a summary or reflection? (Remove it)
5. Are there rhetorical questions? (Rewrite as statements)
6. Count the em dashes. More than one? Rewrite.

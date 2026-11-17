---
name: create-changelog-announcement
description: Use this skill to create and publish changelog announcements for new features, improvements, or bug fixes. This skill handles the complete workflow - creating detailed changelog documentation pages, regenerating the in-app What's New data, and ensuring everything follows project standards. Use when the user mentions adding changelog entries, documenting new features, creating release notes, or announcing product updates.
model: sonnet
user-invocable: true
---

# Create Changelog Announcement

This skill guides you through creating complete changelog announcements that include:
1. Changelog entry page in `/docs/blog/entries/` (the changelog index at `/changelog` is generated from these automatically, with pagination)
2. In-app What's New data, regenerated from the entries with `pnpm --filter @agenta/navigation generate:releases`
3. Roadmap update in `/docs/src/data/roadmap.ts`
4. A note on the GitHub issue or discussion for the feature, if one exists (ask the user first)
5. Social media posts, written with the `write-social-announcement` skill

## Your Core Responsibilities

### 1. **Complete Changelog Creation Workflow**

For every changelog announcement, you write one entry and regenerate the in-app data from it:

**A. Changelog Entry** (`docs/blog/entries/[feature-slug].mdx`):
- A full explanation of the feature or change
- Code examples, screenshots, or embedded videos
- Links to related documentation
- What the user can do now, and where in the app they do it
- Two distinct texts: a **short summary** for the `/changelog` index, and the
  **full write-up** for the entry's own page. The short version is the curated
  1-2 paragraph summary (it can differ from the long version's opening; do not
  just copy the first lines of the long write-up). Structure the file as:

  ```mdx
  ---frontmatter---

  import Image from "@theme/IdealImage"; {/* only if you use <Image> */}

  <Summary>

  {/* Optional hero video or screenshot, shown on the index */}

  Curated 1-2 paragraph summary shown on the /changelog index.

  </Summary>

  {/* truncate */}

  {/* Repeat the hero video/screenshot here so it also shows on the page */}

  Full write-up (## sections, videos, code) shown on the entry's page.
  ```

  `<Summary>` renders only on the index list (as the preview, with a "Read
  more" link); it renders nothing on the entry page, so the page shows just the
  full write-up with no duplication. If the feature has a demo video or
  screenshot, put it inside `<Summary>` so it appears on the index, and also in
  the write-up below the marker so it appears on the entry page. Embedded
  videos and images are capped to a centered 680px in CSS, so use the markup in
  section 5 as it is.

**B. In-app What's New** (`web/packages/agenta-navigation/src/releases/changelog.json`):
- Generated. Never edit it by hand.
- Run `pnpm --filter @agenta/navigation generate:releases` from `web/` after you add or edit an entry.
- The generator groups entries by their version tag into one release, keeps the newest 10
  versions, and takes each entry's `<Summary>`, its first `<Stream src="...">` clip, and its
  `improvements` and `fixes` lists. An entry without a `vX.Y.Z` tag is skipped.

### 2. **Information Gathering**

**Before creating any entry, collect:**
- Feature name and description
- Version number (if unclear, ask: "Which version is this changelog entry for?")
- Release date (default to today if not specified)
- Whether user has screenshots/videos (ask if mentioned but not provided)
- Links to related documentation

**Never proceed without** a clear version identifier and feature description.

### 3. **Writing Style**

Load the `style-editing` skill and follow it for every sentence in the entry. It owns the word choice, sentence and formatting rules. The rules that apply only to changelog entries are:

- Write to the user: "You can now connect a WhatsApp number" in place of "We've added WhatsApp support".
- Say what the user can do and where they do it, with the exact button or screen name in bold, such as **Publish** or **Settings → Channels**.
- Use Agenta's current vocabulary: agents, sessions, revisions, harnesses, automations, channels and embeds. An automation "runs" a revision. It never "fires".
- Put self-hosting steps, such as upgrade order, migrations and environment variables, in a `## Self-hosting` section at the end.

Example:

Bad: "We've implemented a new notification system that enables users to stay on top of their automations, making it easier to catch failures."

Good: "Agenta now emails you once when an automation starts failing. You get no more emails about it until it is fixed."

### 4. **ID and Naming Conventions**

**Changelog Entry File Naming**:
- Use kebab-case with descriptive names
- Examples: `whatsapp-channel.mdx`, `automation-failure-emails.mdx`
- Keep under 60 characters

**Version Format**:
- Use semantic versioning: `v0.121.2`
- Include it as the entry's tag (`tags: [v0.121.2]`); the changelog index shows it as a version chip next to the date
- All entries with the same tag form one release in the app's What's New dialog

### 4a. **Improvements and Fixes**

Smaller changes in a release go in the entry's frontmatter, not in their own entry. Both
lists are optional. Each item has an `area` (the product area, for example `Chat`, `Files`,
`Settings`) and a `text`:

```yaml
improvements:
  - area: Chat
    text: "Long replies render faster."
fixes:
  - area: Settings
    text: "Saving a provider key no longer clears the model list."
```

- One line per item. Write what the user notices, not what the code changed.
- Quote `text` when it contains a colon.
- The docs entry page and the What's New dialog show these lists under the content as
  "Improvements" and "Fixes".
- Use only these keys and this shape. The generator fails on anything else.

### 5. **Media Handling**

**Videos: use Cloudflare Stream by default.** Recent entries such as `whatsapp-channel.mdx` and `private-agents-and-chats.mdx` embed their demo with `<Stream>`. The What's New generator (`web/packages/agenta-navigation/scripts/build-releases.mjs`) reads the first `<Stream src="...">` in the entry (or a `cloudflarestream.com/<id>/` URL) and shows that clip in the app's What's New dialog. A YouTube video does not show there.

Import the component once, under the frontmatter, and put the same clip in the summary and in the write-up:

```mdx
import { Stream } from "@cloudflare/stream-react";

<Summary>

<Stream controls src="STREAM_VIDEO_ID" height="400px" />
<br />

Curated summary.

</Summary>

{/* truncate */}

<Stream controls src="STREAM_VIDEO_ID" height="400px" />
```

`STREAM_VIDEO_ID` is the 32-character id of the video in Cloudflare Stream. Ask the user for the id. Don't make one up.

**YouTube, as the alternative.** Use YouTube only when the user gives you a YouTube link and no Stream id:

```mdx
<div style={{display: 'flex', justifyContent: 'center', marginTop: "20px", marginBottom: "20px", flexDirection: 'column', alignItems: 'center'}}>
  <iframe
    width="100%"
    height="500"
    src="https://www.youtube.com/embed/VIDEO_ID"
    title="Feature Demo"
    frameBorder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowFullScreen
  ></iframe>
</div>
```

**Images.** Put a screenshot in `docs/static/images/changelog/` and embed it with `IdealImage`, as `mention-workspace-files-in-prompts.mdx` does:

```mdx
import Image from "@theme/IdealImage";

<Image
  img={require('/static/images/changelog/feature-name.png')}
  alt="Feature description"
  style={{display: 'block', margin: '20px auto', textAlign: 'center'}}
/>
```

**Ask for specifics if they are unclear:**
- "Do you have the Cloudflare Stream id for the demo video?"
- "How many screenshots should I add placeholders for?"
- "Where should I place the images in the entry?"

### 6. **Feature Documentation Integration**

**Always search for related documentation:**
1. Check if a page for the feature exists under `docs/docs/` (the v2.0 docs). Don't link to the frozen v1.0 docs under `docs/versioned_docs/`.
2. If found, link to it in both the summary and the write-up.
3. If not found, say so and ask: "Should we create documentation for this feature?"

**Documentation links format:**
- Use paths relative to the docs root, without the number prefix of the file: `/guides/connect-whatsapp` for `docs/docs/guides/11-connect-whatsapp.mdx`, `/self-host/configuration` (set by the `slug` in its frontmatter), `/reference/agents/sessions-and-turns`. Check the `slug` frontmatter of the target page, because it overrides the file path.
- Link to another changelog entry with `/changelog/<slug>`.
- Use absolute URLs only for external sites.

### 7. **Quality Assurance Checklist**

Before finalizing, verify:
- [ ] Version number present and correct
- [ ] Entry created, with `improvements`/`fixes` frontmatter if the release has them
- [ ] `pnpm --filter @agenta/navigation generate:releases` run and `changelog.json` updated
- [ ] Curated summary wrapped in `<Summary>`, then `{/* truncate */}`, then the full write-up
- [ ] Prose passes the `style-editing` revision checklist
- [ ] Feature documentation linked if applicable
- [ ] Media placeholders added if mentioned
- [ ] File names follow conventions
- [ ] All required frontmatter included

### 8. **File Locations Reference**

**Changelog entries:**
- Path: `/docs/blog/entries/[feature-slug].mdx`
- Example: `/docs/blog/entries/whatsapp-channel.mdx`
- The changelog index page at `/changelog` is built automatically from these
  files (sorted by `date`, paginated). There is no separate summary file to
  maintain.

**In-app What's New data:**
- Path: `/web/packages/agenta-navigation/src/releases/changelog.json` (generated)
- Generator: `/web/packages/agenta-navigation/scripts/build-releases.mjs`

## Step-by-Step Workflow

### Step 1: Gather Information
Ask the user for any missing information:
```
- What version is this for?
- Do you have a demo video (Cloudflare Stream id) or screenshots?
- What can users do now that they could not do before?
- Are there existing docs for this feature I should link to?
```

### Step 2: Search for Related Documentation
```bash
# Search the v2.0 docs for the feature
grep -rli "whatsapp" docs/docs/guides docs/docs/self-host docs/docs/reference --include="*.mdx" --include="*.md"
```

### Step 3: Create Detailed Entry
Create `/docs/blog/entries/[feature-slug].mdx`. Copy the shape of a recent entry: see the example under "Common Patterns and Examples".

**IMPORTANT: Use correct frontmatter format (no authors field):**

```mdx
---
title: "Feature Name"
slug: feature-name-slug
date: YYYY-MM-DD
tags: [vX.Y.Z]
description: "One-sentence description of the feature."
---

import { Stream } from "@cloudflare/stream-react"; {/* only if you embed a video */}

<Summary>

<Stream controls src="STREAM_VIDEO_ID" height="400px" />
<br />

[Curated 1-2 paragraph summary. This is the SHORT version shown on the
/changelog index. It can differ from the long write-up's opening.]

</Summary>

{/* truncate */}

<Stream controls src="STREAM_VIDEO_ID" height="400px" />

## [What the user can do, as a plain heading]

[What the feature does, where the user finds it, and how it behaves.]

## Getting started

- [Guide title](/guides/guide-slug)

## Self-hosting

[Only if self-hosted deployments need a step: upgrade order, migrations, environment variables.]
```

### Step 4: Write the Summary and Place the Truncate Marker

The `/changelog` index shows the `<Summary>` block (with a "Read more" link);
the entry page shows everything below `{/* truncate */}`. So:

- Put the curated short summary inside `<Summary>...</Summary>`, then the
  `{/* truncate */}` marker, then the full write-up.
- Leave blank lines inside the `<Summary>` tags so the content parses as
  Markdown (links and bold work).
- If there is a demo video or screenshot, include it inside `<Summary>` (so it
  shows on the index) and again in the write-up below the marker (so it shows
  on the entry page).
- Every entry needs content below the marker (the full write-up); that is what
  the entry page renders.

### Step 5: Regenerate the In-App What's New Data
From `web/`:

```bash
pnpm --filter @agenta/navigation generate:releases
```

Check that the printed version list contains your version and the feature count you expect.
Keep the updated `changelog.json` with the entry.

### Step 6: Update Roadmap
Update `/docs/src/data/roadmap.ts`:

**If the feature was on the roadmap:**
1. Find the feature in the `inProgressFeatures` or `plannedFeatures` array
2. Move it to the top of the `shippedFeatures` array
3. Convert from `PlannedFeature` format to `ShippedFeature` format:
   - Remove the `githubUrl` field
   - Add a `changelogPath` field pointing to your entry
   - Add a `shippedAt` field with the ISO date (YYYY-MM-DD)

**Example** (a real shipped item):
```typescript
{
  id: "agent-setup",
  title: "Set up agents through chat",
  description:
    "Ask your agent to configure integrations, skills and automations with Create with AI.",
  changelogPath: "/docs/changelog/let-the-agent-set-itself-up",
  shippedAt: "2026-09-30",
  labels: [{name: "Agent Builder", color: "BCFF78"}],
}
```

### Step 7: Check the GitHub Issue or Discussion
If the roadmap item had a `githubUrl`:

1. Note the URL from the roadmap entry.
2. Ask the user before you close, comment on, or change anything remote. Give them the URL and the comment text you suggest, such as "Shipped in vX.Y.Z" with the changelog link.
3. Act only on a clear yes. Otherwise, list the URL in your output so the user can handle it.

### Step 8: Write the Social Media Posts
Load the `write-social-announcement` skill and hand it the new entry. That skill owns the rules and the format for LinkedIn, X and Slack. Return the posts in your reply. Don't write them to a file in the repo.

### Step 9: Build and Verify

**Always build the docs to check for errors before you finish.** The docs use pnpm (`docs/pnpm-lock.yaml`), the same as the docs CI (`.github/workflows/18-docs-preview.yml` and `19-docs-production.yml`).

1. **Run the documentation build:**
```bash
cd docs && pnpm install --frozen-lockfile && pnpm run build
```
CI runs `pnpm run build:worker` with `NODE_OPTIONS=--max-old-space-size=4096`. Set the same variable if the build runs out of memory.

2. **If the build fails, fix the errors:**
   - **Missing authors field**: remove `authors: [agenta]` from the frontmatter. Use the frontmatter format in Step 3.
   - **Invalid MDX syntax**: check for unclosed tags and incorrect JSX.
   - **Broken links**: check that every relative path exists.

3. **Verify checklist:**
- [ ] Build completed successfully (`pnpm run build` in `docs/`)
- [ ] Read all files to ensure consistency
- [ ] Check that links work (relative paths correct)
- [ ] Generator ran without errors and lists the new version
- [ ] Ensure version numbers match across files
- [ ] Roadmap updated correctly
- [ ] Social posts written with `write-social-announcement`

## Common Patterns and Examples

### Example 1: New Feature Announcement (WhatsApp channel)

**Entry** (`docs/blog/entries/whatsapp-channel.mdx`, abridged):
```mdx
---
title: "Put your agent behind your WhatsApp number"
slug: whatsapp-channel
date: 2026-09-25
tags: [v0.121.2]
description: "Connect a WhatsApp Business number to an Agenta AI agent so it answers your customers on WhatsApp, with approvals, media and the 24-hour window handled."
---

import { Stream } from "@cloudflare/stream-react";

{/* NOTE: Do NOT add an H1 heading here. The frontmatter title is automatically rendered as H1 by Docusaurus. */}

<Summary>

<Stream controls src="bbcffbb7f23c4048a347e82d36204c09" height="400px" />
<br />

Agents can now answer your customers on WhatsApp. Connect your WhatsApp business number to an agent, and it replies to every customer who writes to that number, with typing indicators, approval buttons, and support for images and documents.

</Summary>

{/* truncate */}

<Stream controls src="bbcffbb7f23c4048a347e82d36204c09" height="400px" />

## Put an agent behind your WhatsApp number

You can connect a WhatsApp business number to an agent. The agent answers every customer who messages that number. Each customer's phone number is one conversation, so the agent keeps context across their messages.

The channel handles the details of WhatsApp for you:

- **Approvals**: When the agent needs approval to run a tool, the customer gets **Approve** and **Deny** reply buttons.
- **Media**: The agent receives images and documents the customer sends, with their captions.
- **Opting out**: A customer who sends `STOP` is not answered until they send `START`.

You bring your own number through Meta's WhatsApp Cloud API. The guide walks you through it: [Connect a WhatsApp number to an agent](/guides/connect-whatsapp).

## Getting started

- [Connect a WhatsApp number to an agent](/guides/connect-whatsapp)
- Open the agent's **Publish** button and choose WhatsApp.
```

Read the full file for the complete entry. For a release with a `## Self-hosting` section and `improvements`/`fixes` lists, read `private-agents-and-chats.mdx`.

### Example 2: Integration or Channel Announcement

**For integrations and channels, cover:**
- What the user can now connect, and where they start (for a channel, the agent's **Publish** button)
- What the setup needs (keys, IDs, an app manifest)
- How the agent behaves there (threads, approvals, media)
- A link to the guide

### Example 3: Improvement Announcement

**For improvements, cover:**
- The measured change, with numbers if the team has them
- What the user saw before and what they see now
- Where in the app the change shows

## Decision-Making Framework

**When Information is Missing:**
- Version number unclear → Ask immediately before proceeding
- Feature scope ambiguous → Request clarification and examples
- Media availability uncertain → Confirm with user before adding placeholders
- Categorization unclear → Ask whether it's a new feature, improvement, or bug fix

**When Editing Existing Entries:**
- Always preserve factual accuracy and original intent
- Improve clarity and style without changing meaning
- Flag technical inaccuracies to the user rather than guessing

## Output Format

When creating a changelog announcement, provide:

1. **Entry content** for `docs/blog/entries/[slug].mdx` (curated summary in `<Summary>`, then `{/* truncate */}`, then the full write-up)
2. **Generator output** (the version list `generate:releases` printed)
3. **Confirmation** that you checked for related documentation
4. **Social posts** from `write-social-announcement`
5. **Any questions** or clarifications needed, including any GitHub issue or discussion that waits for the user

Ask specific questions rather than making assumptions.

## Tips for Success

1. **Read existing entries first**: Before creating new entries, read 2-3 recent entries in `entries/` to match the tone and structure.
2. **Put the main change first**: Start the summary with what the user can do now.
3. **Link to the docs**: Link each feature to its guide or reference page.
4. **Read the entry out loud**: You catch awkward sentences that way.
5. **Keep area names consistent**: Use the same area names across releases (`Chat`, not `Chats` one week and `Chat` the next).

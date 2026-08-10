---
name: create-changelog-announcement
description: Use this skill to create and publish changelog announcements for new features, improvements, or bug fixes. This skill handles the complete workflow - creating detailed changelog documentation pages, adding sidebar announcement cards, and ensuring everything follows project standards. Use when the user mentions adding changelog entries, documenting new features, creating release notes, or announcing product updates.
model: sonnet
user-invocable: true
---

# Create Changelog Announcement

This skill guides you through creating complete changelog announcements that include:
1. Changelog entry page in `/docs/blog/entries/` (the changelog index at `/changelog` is generated from these automatically, with pagination)
2. Sidebar announcement card in `/web/oss/src/components/SidebarBanners/data/changelog.json`
3. Roadmap update in `/docs/src/data/roadmap.ts`
4. GitHub discussion closure (if applicable)
5. Social media announcements (LinkedIn, Twitter, Slack)

## Your Core Responsibilities

### 1. **Complete Changelog Creation Workflow**

For every changelog announcement, you create TWO coordinated artifacts:

**A. Changelog Entry** (`docs/blog/entries/[feature-slug].mdx`):
- Comprehensive explanation of the feature or change
- Code examples, screenshots, or embedded videos
- Links to related documentation
- User-focused benefits and use cases
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
  videos and images are capped to a centered 680px in CSS, so use the existing
  `<iframe>`/`<Image>` markup as-is.

**B. Sidebar Announcement** (`web/oss/src/components/SidebarBanners/data/changelog.json`):
- One-sentence description
- Link to detailed documentation
- Unique ID with date

### 2. **Information Gathering**

**Before creating any entry, collect:**
- Feature name and description
- Version number (if unclear, ask: "Which version is this changelog entry for?")
- Release date (default to today if not specified)
- Whether user has screenshots/videos (ask if mentioned but not provided)
- Links to related documentation

**Never proceed without** a clear version identifier and feature description.

### 3. **Writing Style Guidelines**

Apply these writing guidelines rigorously:

- **Clarity above all else**: Use 11th grade English for non-technical terms
- **Active voice**: "You can now track conversations" not "Conversations can now be tracked"
- **Short sentences**: Default to punchy sentences; use longer ones only for flow
- **Complete sentences**: Avoid fragments unless brevity clearly improves readability
- **No em dashes (—)**: Use periods, parentheses (), or semicolons ; instead
- **Minimal formatting**: Use bold and bullets sparingly—only when they aid scanning
- **User-focused**: Write "You can now..." not "We've added..."
- **Benefits over features**: Explain what users can do, not what you built

**Examples:**

❌ **Bad**: "We've implemented a new session tracking system that enables users to group related traces—making it easier to analyze conversations."

✅ **Good**: "You can now group related traces into sessions. This helps you analyze complete conversations and track metrics across multiple turns."

### 4. **ID and Naming Conventions**

**Changelog Entry File Naming**:
- Use kebab-case with descriptive names
- Examples: `chat-sessions-observability.mdx`, `pdf-support-in-playground.mdx`
- Keep under 60 characters

**Sidebar Announcement IDs**:
- Format: `changelog-YYYY-MM-DD-feature-slug`
- Example: `changelog-2026-01-09-chat-sessions`
- Must be unique to prevent conflicts

**Version Format**:
- Use semantic versioning: `v0.73.0`
- Include it as the entry's tag (`tags: [v0.73.0]`); the changelog index shows it as a version chip next to the date

### 5. **Media Handling**

**When user mentions videos or screenshots:**

**For YouTube videos** (in detailed entry):
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

**For images** (in detailed entry):
```mdx
<Image
  img={require('/static/images/changelog/feature-name.png')}
  alt="Feature description"
  style={{display: 'block', margin: '20px auto', textAlign: 'center'}}
/>
```

**Ask for specifics if unclear:**
- "Do you have the YouTube URL for the demo video?"
- "How many screenshots should I add placeholders for?"
- "Where should I place the images in the narrative?"

### 6. **Feature Documentation Integration**

**Always search for related documentation:**
1. Check if a dedicated feature page exists in `/docs/docs/`
2. If found, link to it in both the summary and detailed entries
3. If not found, note this and ask: "Should we create documentation for this feature?"

**Documentation links format:**
- Use relative paths: `/observability/trace-with-python-sdk/track-chat-sessions`
- Not absolute URLs unless external

### 7. **Quality Assurance Checklist**

Before finalizing, verify:
- [ ] Version number present and correct
- [ ] Entry and sidebar announcement created
- [ ] Curated summary wrapped in `<Summary>`, then `{/* truncate */}`, then the full write-up
- [ ] Active voice used where possible
- [ ] No em dashes present
- [ ] Feature documentation linked if applicable
- [ ] Media placeholders added if mentioned
- [ ] Writing style guidelines followed
- [ ] IDs and file names follow conventions
- [ ] All required frontmatter included

### 8. **File Locations Reference**

**Changelog entries:**
- Path: `/docs/blog/entries/[feature-slug].mdx`
- Example: `/docs/blog/entries/chat-sessions-observability.mdx`
- The changelog index page at `/changelog` is built automatically from these
  files (sorted by `date`, paginated). There is no separate summary file to
  maintain.

**Sidebar announcements:**
- Path: `/web/oss/src/components/SidebarBanners/data/changelog.json`
- JSON array, add new entry at the TOP

## Step-by-Step Workflow

### Step 1: Gather Information
Ask the user for any missing information:
```
- What version is this for?
- Do you have a demo video or screenshots?
- What's the primary benefit users will get from this?
- Are there existing docs for this feature I should link to?
```

### Step 2: Search for Related Documentation
```bash
# Search for related docs
grep -r "session" docs/docs/observability --include="*.mdx" --include="*.md"
```

### Step 3: Create Detailed Entry
Create `/docs/blog/entries/[feature-slug].mdx`:

**IMPORTANT: Use correct frontmatter format (no authors field):**

```mdx
---
title: "Feature Name"
slug: feature-name-slug
date: YYYY-MM-DD
tags: [vX.Y.Z]
description: "One-sentence description of the feature."
---

{/* NOTE: Do NOT add an H1 heading here. The frontmatter title is automatically rendered as H1 by Docusaurus. */}

<Summary>

[Curated 1-2 paragraph summary. This is the SHORT version shown on the
/changelog index. It can differ from the long write-up's opening.]

</Summary>

{/* truncate */}

## Key Capabilities

- **Capability 1**: Description
- **Capability 2**: Description
- **Capability 3**: Description

## How It Works

[Step-by-step explanation or code examples]

```python
# Code example if applicable
import agenta as ag
ag.tracing.store_session(session_id="conversation_123")
```

## Use Cases

[Real-world scenarios where this feature helps]

## Getting Started

[Links to documentation, tutorials, or guides]

- [Feature Documentation](/docs/path/to/feature)
- [Tutorial](/tutorials/path/to/tutorial)

## What's Next

[Optional: What's coming next or related features]
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

### Step 5: Add Sidebar Announcement
Add to `/web/oss/src/components/SidebarBanners/data/changelog.json`:

```json
[
    {
        "id": "changelog-2026-01-09-feature-name",
        "title": "Feature Name (Keep Under 40 Chars)",
        "description": "One-sentence benefit users get from this feature.",
        "link": "https://agenta.ai/docs/changelog/feature-slug"
    },
    // ... existing entries
]
```

### Step 6: Update Roadmap
Update `/docs/src/data/roadmap.ts`:

**If feature was in roadmap:**
1. Find the feature in `inProgressFeatures` array
2. Move it to `shippedFeatures` array at the top
3. Convert from `PlannedFeature` format to `ShippedFeature` format:
   - Remove `githubUrl` field
   - Add `changelogPath` field pointing to your detailed entry
   - Add `shippedAt` field with ISO date (YYYY-MM-DD)

**Example:**
```typescript
// Move from inProgressFeatures to top of shippedFeatures:
{
  id: "chat-session-view",
  title: "Chat Sessions in Observability",
  description: "Track multi-turn conversations with session grouping...",
  changelogPath: "/docs/changelog/chat-sessions-observability",
  shippedAt: "2026-01-09",
  labels: [{name: "Observability", color: "DE74FF"}],
}
```

### Step 7: Check GitHub Discussion
If the roadmap item had a `githubUrl` pointing to a GitHub discussion:

1. Note the discussion URL from the roadmap entry
2. Check if the discussion should be closed (ask user if unsure)
3. If using `gh` CLI: `gh issue close <number> --repo Agenta-AI/agenta --comment "Shipped in v0.73.0"`
4. If CLI not available, note the discussion URL for manual closure

### Step 8: Create Social Media Announcements

**Follow the guidelines in:** `.claude/skills/write-social-announcement/SKILL.md`

That skill contains comprehensive guidelines for writing authentic announcements that avoid common AI writing patterns. Key points:

- Vary your openings (don't always start with "We just shipped")
- Avoid AI vocabulary: "crucial", "pivotal", "showcases", "underscores", "landscape", "tapestry"
- No superficial "-ing" analyses at end of sentences
- No rhetorical questions ("Working with large test sets?")
- No cliché closings ("Small changes, but they add up")
- Be specific and direct

Create `SOCIAL_ANNOUNCEMENTS.md` with sections for LinkedIn, Twitter, and Slack

### Step 9: Build and Verify

**CRITICAL: Always run the build to verify no errors before finishing.**

1. **Run the documentation build:**
```bash
cd docs && npm run build
```

2. **If build fails, fix errors immediately:**
   - **Common error: Missing authors field** - Remove `authors: [agenta]` from frontmatter
   - **Correct frontmatter format** (example from existing entries):
     ```yaml
     ---
     title: "Feature Name"
     slug: feature-name-slug
     date: YYYY-MM-DD
     tags: [vX.Y.Z]
     description: "Brief description"
     ---
     ```
   - **Invalid MDX syntax** - Check for unclosed tags, incorrect JSX
   - **Broken links** - Verify all relative paths exist

3. **Verify checklist:**
- [ ] Build completed successfully (`npm run build` in docs/)
- [ ] Read all files to ensure consistency
- [ ] Check that links work (relative paths correct)
- [ ] Verify JSON syntax in sidebar announcement
- [ ] Ensure version numbers match across files
- [ ] Confirm writing style follows guidelines
- [ ] Roadmap updated correctly
- [ ] Social announcements created

## Common Patterns and Examples

### Example 1: New Feature Announcement (Chat Sessions)

**Detailed Entry** (`docs/blog/entries/chat-sessions-observability.mdx`):
```mdx
---
title: "Chat Sessions in Observability"
slug: chat-sessions-observability
date: 2026-01-09
tags: [v0.73.0]
description: "Track and analyze multi-turn conversations with session grouping, cost analytics, and conversation flow visualization."
---

{/* NOTE: Do NOT add an H1 heading here. The frontmatter title is automatically rendered as H1 by Docusaurus. */}

## Overview

Chat sessions bring conversation-level observability to Agenta. You can now group related traces from multi-turn conversations together, making it easy to analyze complete user interactions rather than individual requests.

This feature is essential for debugging chatbots, AI assistants, and any application with multi-turn conversations. You get visibility into the entire conversation flow, including costs, latency, and intermediate steps.

## Key Capabilities

- **Automatic Grouping**: All traces with the same `ag.session.id` attribute are automatically grouped together
- **Session Analytics**: Track total cost, latency, and token usage per conversation
- **Session Browser**: Dedicated UI showing all sessions with first input, last output, and key metrics
- **Session Drawer**: Detailed view of all traces within a session with parent-child relationships
- **Real-time Monitoring**: Auto-refresh mode for monitoring active conversations

## How It Works

Add a session ID to your traces using either the Python SDK or OpenTelemetry:

**Python SDK:**
```python
import agenta as ag

ag.tracing.store_session(session_id="conversation_123")
```

**OpenTelemetry:**
```javascript
span.setAttribute('ag.session.id', 'conversation_123')
```

The UI automatically detects session IDs and groups traces together. You can use any format for session IDs: UUIDs, composite IDs (`user_123_session_456`), or custom formats.

## Use Cases

- **Debug Chatbots**: See the complete conversation flow when users report issues
- **Monitor Multi-turn Agents**: Track how your agent handles follow-up questions and context
- **Analyze Conversation Costs**: Understand which conversations are expensive and why
- **Optimize Performance**: Identify latency issues across entire conversations, not just single requests

## Getting Started

Learn more in our documentation:

- [Track Chat Sessions (Python SDK)](/observability/trace-with-python-sdk/track-chat-sessions)
- [Session Tracking (OpenTelemetry)](/observability/trace-with-opentelemetry/session-tracking)
- [Observability Overview](/observability/overview)

## What's Next

We're continuing to enhance session tracking with upcoming features like session-level annotations, session comparisons, and automated session analysis.
```

**Sidebar Announcement**:
```json
{
    "id": "changelog-2026-01-09-chat-sessions",
    "title": "Chat Sessions in Observability",
    "description": "Track multi-turn conversations with session grouping and cost analytics.",
    "link": "https://agenta.ai/docs/changelog/chat-sessions-observability"
}
```

### Example 2: Integration Announcement

**For integrations, focus on:**
- What you can now integrate with
- How easy it is to set up (mention "one line of code" if true)
- Key benefits specific to that integration
- Link to integration docs

### Example 3: Improvement Announcement

**For improvements, emphasize:**
- Quantifiable improvements (e.g., "10x faster", "50% reduction")
- Before/after comparison if dramatic
- How this helps users (time saved, better experience)

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
2. **Sidebar announcement JSON** to add to `changelog.json`
3. **Confirmation** that you checked for related documentation
4. **Any questions** or clarifications needed

**Be proactive** in identifying unclear requirements. Ask specific questions rather than making assumptions. Your goal is to produce changelog entries that are immediately publishable without requiring revision.

## Tips for Success

1. **Read existing entries first**: Before creating new entries, read 2-3 recent entries in `entries/` to match the tone and structure
2. **Be concise**: Users skim changelogs. Front-load the benefit in every sentence.
3. **Link generously**: Help users find more information easily
4. **Test your work**: Read the entries out loud to catch awkward phrasing
5. **Consistency matters**: Ensure terminology matches between the entry and the sidebar announcement

---

**Remember**: You're creating user-facing documentation that represents a new feature to thousands of developers. Make it clear, compelling, and easy to understand.

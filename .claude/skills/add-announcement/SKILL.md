---
name: add-announcement
description: Helps add announcement cards to the sidebar banner system. Use when adding changelog entries, feature announcements, updates, or promotional banners to the Agenta sidebar. Handles both simple changelog entries and complex custom banners.
allowed-tools: Read, Edit, Grep, Glob
user-invocable: true
---

# Add Announcement Card

This skill helps you add announcement cards to the Agenta sidebar banner system. Announcement cards appear at the bottom of the sidebar and can be dismissed by users.

## System Overview

The sidebar banner system is located at `web/oss/src/components/SidebarBanners/` and uses:
- **Priority-based queue**: Only one banner shows at a time
- **Auto-progression**: When dismissed, the next highest priority banner appears
- **Persistent dismissal**: Uses localStorage to remember dismissed banners
- **Jotai atoms**: For reactive state management

## Two Types of Announcements

### 1. Simple Changelog Announcements (Most Common)

For standard product updates, features, and changes, simply add to `changelog.json`:

**File**: `web/oss/src/components/SidebarBanners/data/changelog.json`

**Format**:
```json
{
    "id": "changelog-YYYY-MM-DD-feature-name",
    "title": "Feature Title (Short)",
    "description": "Brief description of the feature or change.",
    "link": "https://agenta.ai/docs/changelog/feature-name"
}
```

**ID Convention**: `changelog-` + date (YYYY-MM-DD) + feature slug
- Example: `changelog-2026-01-09-chat-sessions`
- Must be unique to prevent conflicts

**Title Guidelines**:
- Keep under 40 characters
- Clear and actionable
- Focus on user benefit
- Examples: "Chat Sessions in Observability", "PDF Support in Playground"

**Description Guidelines**:
- One sentence, under 100 characters
- Describe what users can do, not technical details
- Examples: "Track multi-turn conversations with session grouping and cost analytics."

**Link Convention**:
- Always points to `https://agenta.ai/docs/changelog/[feature-slug]`
- You'll need to create the corresponding changelog documentation page

### 2. Custom Banners (Advanced)

For complex banners with custom UI, interactions, or logic (trial warnings, upgrade prompts, etc.), you need to:

1. Add the banner type to `types.ts`
2. Add priority to `state/atoms.ts`
3. Create the banner in `activeBannersAtom` (OSS) or `eeBannersAtom` (EE)

**When to use custom banners**:
- Non-dismissible banners (e.g., trial expiration)
- Custom interactions (buttons with onClick handlers)
- Dynamic content (depends on user state)
- Conditional display (show only under certain conditions)

## Step-by-Step: Adding a Simple Changelog Announcement

### Step 1: Read the current changelog.json
```bash
# View current entries to understand the structure
cat web/oss/src/components/SidebarBanners/data/changelog.json
```

### Step 2: Add your entry
Edit `web/oss/src/components/SidebarBanners/data/changelog.json` and add your new entry to the array:

```json
[
    {
        "id": "changelog-2024-12-16-pdf-support",
        "title": "PDF Support in Playground",
        "description": "You can now upload and test PDFs directly in the playground.",
        "link": "https://agenta.ai/docs/changelog/pdf-support-in-playground"
    },
    {
        "id": "changelog-2026-01-09-your-feature",
        "title": "Your Feature Title",
        "description": "Brief description of what users can do.",
        "link": "https://agenta.ai/docs/changelog/your-feature-slug"
    }
]
```

### Step 3: Verify the format
- Ensure valid JSON (no trailing commas, proper quotes)
- Check ID uniqueness
- Verify link URL matches the documentation page you'll create

### Step 4: Test locally
The banner will automatically appear in the sidebar on the next page load. To see it:
1. Clear localStorage: `localStorage.removeItem('agenta:dismissed-banners')`
2. Refresh the page
3. Banner should appear at bottom of sidebar

## Banner Priority System

Banners are shown in priority order (lower number = shown first):

```
Priority 0: star-repo (GitHub star prompt for new users)
Priority 1: changelog (product updates) ← Most changelog entries
Priority 2: upgrade (upgrade prompts)
Priority 3: trial (trial/billing warnings)
```

Changelog entries automatically get priority 1.

## Common Patterns and Examples

### Example 1: Feature Announcement
```json
{
    "id": "changelog-2026-01-15-batch-evaluation",
    "title": "Batch Evaluation Available",
    "description": "Evaluate multiple test sets simultaneously with batch processing.",
    "link": "https://agenta.ai/docs/changelog/batch-evaluation"
}
```

### Example 2: Integration Announcement
```json
{
    "id": "changelog-2026-01-20-langchain-support",
    "title": "LangChain v0.3 Support",
    "description": "Full support for LangChain v0.3 with auto-instrumentation.",
    "link": "https://agenta.ai/docs/changelog/langchain-v03"
}
```

### Example 3: Improvement Announcement
```json
{
    "id": "changelog-2026-01-25-faster-traces",
    "title": "10x Faster Trace Loading",
    "description": "Observability page now loads traces up to 10x faster.",
    "link": "https://agenta.ai/docs/changelog/faster-trace-loading"
}
```

## Related Files

### Core System Files
- `web/oss/src/components/SidebarBanners/index.tsx` - Main container
- `web/oss/src/components/SidebarBanners/SidebarBanner.tsx` - Display component
- `web/oss/src/components/SidebarBanners/types.ts` - Type definitions
- `web/oss/src/components/SidebarBanners/state/atoms.ts` - State management
- `web/oss/src/components/SidebarBanners/data/changelog.json` - Changelog data

### Integration Point
- `web/oss/src/components/Sidebar/Sidebar.tsx` - Where banners are rendered

### EE Override (Enterprise Edition)
- `web/ee/src/components/SidebarBanners/index.tsx` - EE wrapper
- `web/ee/src/components/SidebarBanners/state/atoms.ts` - EE banners (trial, upgrade)

## Best Practices

1. **Timing**: Add announcements when features are fully deployed and documented
2. **User-focused**: Write from user perspective ("You can now..."), not technical perspective
3. **Brevity**: Keep title and description short - users skim banners
4. **Links**: Always link to comprehensive documentation, not just a blog post
5. **Testing**: Clear localStorage and verify the banner displays correctly
6. **Uniqueness**: Use date-based IDs to prevent conflicts with past/future announcements

## Troubleshooting

**Banner not appearing?**
- Check JSON syntax (use a JSON validator)
- Clear localStorage: `localStorage.removeItem('agenta:dismissed-banners')`
- Verify you're looking at the correct environment (OSS vs EE)
- Check browser console for errors

**Banner appearing multiple times?**
- Ensure ID is unique (not already in the dismissed list)
- Check for duplicate entries in changelog.json

**Banner styling looks wrong?**
- The SidebarBanner component handles all styling automatically
- Don't add custom HTML/styling in description - it's rendered as plain text

## Next Steps After Adding Announcement

After adding the announcement to `changelog.json`, you should:

1. **Create changelog documentation page** at `docs/docs/changelog/[feature-slug].mdx`
2. **Add screenshots or demo video** to the documentation
3. **Link to related feature documentation** from the changelog page
4. **Test the banner** in both OSS and EE environments
5. **Commit changes** with a descriptive commit message

## Example Workflow

```bash
# 1. Edit changelog.json
code web/oss/src/components/SidebarBanners/data/changelog.json

# 2. Create documentation page
code docs/docs/changelog/your-feature.mdx

# 3. Test locally (if running dev server)
# Clear localStorage in browser console:
# localStorage.removeItem('agenta:dismissed-banners')

# 4. Commit
git add web/oss/src/components/SidebarBanners/data/changelog.json
git add docs/docs/changelog/your-feature.mdx
git commit -m "docs: add changelog announcement for [feature name]"
```

---

**Note**: This skill focuses on simple changelog announcements. For custom banners with complex logic, consult the SidebarBanners README or ask for guidance on creating custom banner components.

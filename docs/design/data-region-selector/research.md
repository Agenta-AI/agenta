# Research: Data Region Selector

## Langfuse Reference Implementation

Langfuse has a region selector that we can reference. Key findings:

**File:** `/langfuse/web/src/features/auth/components/AuthCloudRegionSwitch.tsx`

**How they detect cloud:**
```typescript
// Environment variable determines if cloud + which region
const isLangfuseCloud = Boolean(env.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION)
const region = env.NEXT_PUBLIC_LANGFUSE_CLOUD_REGION // "EU" | "US" | "HIPAA" | "STAGING" | "DEV"
```

**Region configuration:**
```typescript
const regions = [
  { name: "US", hostname: "us.cloud.langfuse.com", flag: "US" },
  { name: "EU", hostname: "cloud.langfuse.com", flag: "EU" },  // EU is default domain
]
```

**UI Pattern:**
- Dropdown `<Select>` showing current region with flag
- "(what is this?)" link opens a Dialog with explanation
- Region switch changes `window.location.hostname` directly
- No localStorage persistence - relies on URL

**Key Design Elements:**
1. Info dialog explains: regions are separate, no data shared, can have accounts in multiple regions
2. Minimal friction - just a dropdown, no confirmation modal

**What we can adopt:**
- Environment variable pattern for cloud detection
- Info dialog instead of confirmation modal (user's feedback!)
- Direct hostname switch

**What we'll do in v1:**
- Keep `cloud.agenta.ai` as an EU alias (no preference-based auto-redirect)
- Region switch is explicit (user clicks US/EU)

---

## Codebase Analysis

### Current Sign-In Architecture

**Auth Page Location:** `web/oss/src/pages/auth/[[...path]].tsx`
- The EE version (`web/ee/src/pages/auth/[[...path]].tsx`) re-exports the OSS implementation
- This means changes can be made in OSS and conditionally rendered for cloud

**Cloud Detection:** `web/oss/src/lib/helpers/isEE.ts`
```typescript
export const isEE = () => {
    const license = getEnv("NEXT_PUBLIC_AGENTA_LICENSE")?.toLowerCase()
    if (!license) return false
    return license === "ee" || license.startsWith("cloud")
}
```

**Key Insight:** The license string pattern already supports region prefixes:
- `cloud` - Generic cloud
- `cloud_eu` - EU region
- `cloud_us` - US region

This could be leveraged but URL-based detection is more reliable for region.

### Environment Configuration

Environment variables are loaded from:
1. `window.__env` (runtime config for containers)
2. `process.env` (build-time)

**Relevant variables:**
- `NEXT_PUBLIC_AGENTA_WEB_URL` - Current instance URL
- `NEXT_PUBLIC_AGENTA_API_URL` - Backend API URL
- `NEXT_PUBLIC_AGENTA_LICENSE` - License type

### Auth Flow Structure

```
/auth                     -> Main sign-in page
├── Social auth buttons   -> Google, GitHub, etc.
├── Email input           -> Discovery flow
├── Password/OTP          -> Based on discovery
└── SSO redirect          -> Enterprise SSO
```

The auth page has two main sections:
1. **Left panel** - Auth form (social buttons, email input, etc.)
2. **Right panel** - Side banner (marketing content, hidden on mobile)

---

## Industry Patterns Research

### How Other SaaS Products Handle Region Selection

#### Pattern 1: Subdomain-Based (Most Common)
**Examples:** Atlassian, Notion, Linear, Supabase

```
app.example.com      -> Default/selector
eu.app.example.com   -> EU instance
us.app.example.com   -> US instance
```

**Pros:**
- Clear from URL which region
- Each region is completely isolated
- Works with existing infrastructure

**Cons:**
- Users need to remember their region
- Switching requires redirect

#### Pattern 2: Region Selector on Login Page
**Examples:** AWS, Azure, GCP

Show a dropdown/toggle before or during sign-in.

**Pros:**
- Clear choice point
- Can show additional info

**Cons:**
- Extra step in flow
- May confuse users

#### Pattern 3: Post-Login Selection
**Examples:** Some enterprise tools

Let users sign in, then select/see their region.

**Pros:**
- Simpler initial flow
- Can show user's data location

**Cons:**
- Requires shared auth system
- More complex architecture

#### Pattern 4: Automatic with Override
**Examples:** Cloudflare, some CDN providers

Detect via IP, allow override.

**Pros:**
- Frictionless for most users

**Cons:**
- Privacy concerns (geolocation)
- Can be wrong for VPN users

### Recommended Pattern for Agenta

**Hybrid of Pattern 1 + 2 (with button-style selector):**
- URL determines the instance (separate hosts per region)
- Show region selector on sign-in page
- Provide an explicit switch (two selectable buttons) + on-demand education (modal)
- Keep `cloud.agenta.ai` as an EU alias (do not force redirects between `cloud` and `eu`)

---

## Technical Considerations

### Environment Variables for Cloud Detection

Currently, `isEE()` checks if license starts with "cloud", but we want a cleaner way to:
1. Detect if we're on Cloud (not self-hosted EE)
2. Know which region we're in

**Proposed new env var:** `NEXT_PUBLIC_AGENTA_CLOUD_REGION`

| Value | Meaning |
|-------|---------|
| Not set | Not cloud (OSS or self-hosted EE) |
| `"eu"` | Cloud EU region |
| `"us"` | Cloud US region |

**Helper functions:**
```typescript
// web/oss/src/lib/helpers/region.ts

export const isAgentaCloud = () => {
    return Boolean(getEnv("NEXT_PUBLIC_AGENTA_CLOUD_REGION"))
}

export const getCloudRegion = (): "eu" | "us" | null => {
    const region = getEnv("NEXT_PUBLIC_AGENTA_CLOUD_REGION")?.toLowerCase()
    if (region === "eu" || region === "us") return region
    return null
}
```

This follows Langfuse's pattern exactly: `NEXT_PUBLIC_LANGFUSE_CLOUD_REGION`.

### Region Detection

In v1, region identity should come from `NEXT_PUBLIC_AGENTA_CLOUD_REGION` (set per deployment).

Notes:
- EU deployment may be reachable via both `cloud.agenta.ai` and `eu.cloud.agenta.ai` (alias/proxy). In that case, both hosts share the same env and represent EU.
- US deployment is `us.cloud.agenta.ai`.

### Switching Regions

Since each region is a separate instance:
1. User clicks "Switch to US"
2. Redirect to `https://us.cloud.agenta.ai/auth`
3. User must sign in again (different auth system)
4. No data is transferred

**Important UX Note:** Make it clear that:
- Accounts are separate per region
- Data does not sync between regions
- User needs to sign up again in new region

### Default Behavior for `cloud.agenta.ai`

Given current infra constraints described by stakeholders:
- `cloud.agenta.ai` is treated as an **EU alias** and should not automatically redirect to `eu.cloud.agenta.ai`.
- The region selector is still shown and allows switching to `us.cloud.agenta.ai`.

---

## Files to Modify

### Primary Changes
1. `web/oss/src/pages/auth/[[...path]].tsx` - Add region indicator/selector
2. `web/oss/src/components/pages/auth/RegionSelector/` - New component
3. `web/oss/src/lib/helpers/region.ts` - Region detection utilities

### Supporting Changes
4. `web/oss/src/lib/helpers/dynamicEnv.ts` - Add region env var
5. `web/oss/src/components/pages/auth/SideBanner/` - Possibly show region info

### New Pages (Optional)
6. `web/oss/src/pages/data-regions.tsx` - Info page about regions

---

## Gotchas and Edge Cases

1. **Alias host** - EU may be served under `cloud.agenta.ai` and/or `eu.cloud.agenta.ai`; ensure auth callbacks (`NEXT_PUBLIC_AGENTA_WEB_URL`) are compatible with whichever host is used.

2. **Switch link preservation** - When switching regions, preserve `pathname + search + hash` so deep links and auth flows aren't broken.

3. **OAuth/SSO callbacks** - Social/SSO callbacks use `NEXT_PUBLIC_AGENTA_WEB_URL` in several places (see `web/oss/src/components/pages/auth/SocialAuth/index.tsx` and `web/oss/src/config/appInfo.ts`). If EU uses `cloud.agenta.ai` as website domain, callbacks may land on the alias host.

4. **Mobile view** - The side banner is hidden on mobile, need alternative placement for region info.

5. **Existing users** - Users who signed up before multi-region need to know their data is in EU (or wherever the original region was).

6. **Cookie/session scope** - Sessions/cookies are origin-scoped; users will re-authenticate when switching regions.

# Execution Plan: Data Region Selector

## Goal

Add a data-region selector to the Cloud sign-in screen that:
- is shown only on Agenta Cloud
- clearly indicates the current region (EU/US)
- lets users switch regions explicitly (click -> redirect)
- provides a "Learn more" modal explaining data regions

## Assumptions (Current Infra)

- EU Cloud is reachable via **both** `cloud.agenta.ai` (alias) and `eu.cloud.agenta.ai`.
- US Cloud is `us.cloud.agenta.ai`.
- `cloud.agenta.ai` should **not** auto-redirect to `eu.cloud.agenta.ai` (URL should remain as-is).

---

## Phase 1: Config + Helpers

### 1.1 Add Cloud Region Env Var

Add `NEXT_PUBLIC_AGENTA_CLOUD_REGION` to:
- `web/oss/src/lib/helpers/dynamicEnv.ts`'s `processEnv`
- `web/entrypoint.sh` runtime `window.__env` generation (so Cloud deployments can set it via an env var)

Expected values:
- `"eu"` for EU deployment (including the `cloud.agenta.ai` alias)
- `"us"` for US deployment
- unset for OSS / self-hosted EE

Runtime wiring suggestion:
- `AGENTA_CLOUD_REGION` -> `NEXT_PUBLIC_AGENTA_CLOUD_REGION` in `web/entrypoint.sh` (mirrors `AGENTA_WEB_URL` -> `NEXT_PUBLIC_AGENTA_WEB_URL`).

### 1.2 Region Utilities

Create `web/oss/src/lib/helpers/region.ts`:

```ts
import { getEnv } from "./dynamicEnv"

export const REGIONS = {
  eu: { id: "eu", label: "EU", flag: "🇪🇺", host: "eu.cloud.agenta.ai" },
  us: { id: "us", label: "US", flag: "🇺🇸", host: "us.cloud.agenta.ai" },
} as const

export type RegionId = keyof typeof REGIONS

export const getCloudRegion = (): RegionId | null => {
  const v = getEnv("NEXT_PUBLIC_AGENTA_CLOUD_REGION")?.toLowerCase()
  return v === "eu" || v === "us" ? v : null
}

export const shouldShowRegionSelector = () => getCloudRegion() !== null

export const isCloudAliasHost = () => {
  if (typeof window === "undefined") return false
  return window.location.hostname === "cloud.agenta.ai"
}

export const buildSwitchUrl = (target: RegionId) => {
  if (typeof window === "undefined") return null
  const { protocol, pathname, search, hash } = window.location
  const host = REGIONS[target].host
  return `${protocol}//${host}${pathname}${search}${hash}`
}
```

Notes:
- We preserve `pathname + search + hash` to avoid breaking invites and auth callback routes.
- `isCloudAliasHost()` allows us to avoid switching from `cloud.agenta.ai` -> `eu.cloud.agenta.ai` when the user selects EU (no-op).

---

## Phase 2: UI Components

Create `web/oss/src/components/pages/auth/RegionSelector/`:

```
RegionSelector/
  index.tsx            # two button-style selectors + helper text
  RegionInfoModal.tsx  # "Learn more" modal
  useRegionSelector.ts # reads current region + performs redirect
```

### Behavior

- Render only when `shouldShowRegionSelector()`.
- Selected state reflects `getCloudRegion()`.
- Clicking the other region redirects immediately:
  - `eu` -> `eu.cloud.agenta.ai` (unless already on EU / alias)
  - `us` -> `us.cloud.agenta.ai`
- EU special-case: if current host is `cloud.agenta.ai` and EU is selected, do nothing (stay on alias).
- Copy: `This can be changed later. Learn more` (modal opens on Learn more).

---

## Phase 3: Integrate Into Sign-In

Modify `web/oss/src/pages/auth/[[...path]].tsx`:
- Place selector above social auth buttons (and above email form), near the top of the auth column.
- Ensure it does not interfere with current auth flows (social auth, email discovery, SSO).

---

## Fundamental Config Check (Auth Callbacks)

This feature relies on region-specific domains working end-to-end for auth.

Confirm environment variables per deployment:
- `NEXT_PUBLIC_AGENTA_WEB_URL` should match the callback host you want to use.
  - Social auth uses this directly in `web/oss/src/components/pages/auth/SocialAuth/index.tsx`.
  - SSO callback URLs also use `getAgentaWebUrl()` in `web/oss/src/pages/auth/[[...path]].tsx`.
- US deployment should be `https://us.cloud.agenta.ai`.
- EU deployment can be `https://cloud.agenta.ai` (alias) or `https://eu.cloud.agenta.ai`, but it must be consistent with provider configuration.

---

## Definition of Done

- Region selector appears on Cloud sign-in only.
- Two buttons show clear selected/unselected state.
- Clicking the other region redirects immediately and preserves `pathname + search + hash`.
- "Learn more" opens an info modal.
- Implementation uses button-style selectors (no dropdown) and no confirmation modal.

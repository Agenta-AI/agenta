import changelogData from "./changelog.json"

import type {Release} from "./index"

/** Newest first. Generated from docs/blog/entries by `pnpm generate:releases`; do not hand-edit. */
// Its own module, so state.ts and seen.ts read it without a runtime import of ./index, which
// imports them back.
export const RELEASES: Release[] = changelogData as Release[]

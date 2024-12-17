import {atom} from "jotai"
import {type PostHog, type PostHogConfig} from "posthog-js"

export type {PostHogConfig}
export const posthogAtom = atom<PostHog | null>(null)

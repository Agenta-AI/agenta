import {atom} from "jotai"
import {type PostHog} from "posthog-js"

export const posthogAtom = atom<PostHog | null>(null)

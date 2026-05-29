import {logAtom, sessionAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {withImmer} from "jotai-immer"

// sessionExistsAtom is a re-export of the shared sessionAtom. Previously
// there were two parallel auth-state atoms (this one, plus
// @agenta/shared/state's sessionAtom for entity packages) and SessionListener
// / useSession had to dual-write to keep them in sync. The two could drift
// for one React-effect tick after hydration, which gated oss queries
// (projects, profile, orgs, access, observability) on the slower atom and
// produced visible flakes — notably the demo-workspace banner not appearing
// on cold reload. Re-exporting the shared atom collapses the two into one
// source of truth without touching the ~14 call sites that import this name.
export const sessionExistsAtom = sessionAtom

const baseSessionLoadingAtom = atom(true)
export const sessionLoadingAtom = withImmer(baseSessionLoadingAtom)

export type AuthFlowState = "authed" | "unauthed" | "authing"
const baseAuthFlowAtom = atom<AuthFlowState>("unauthed")
export const authFlowAtom = withImmer(baseAuthFlowAtom)

const logSession = process.env.NEXT_PUBLIC_LOG_SESSION_ATOMS === "true"
logAtom(sessionExistsAtom, "sessionExistsAtom", logSession)

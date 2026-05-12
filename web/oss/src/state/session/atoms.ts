import {logAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {withImmer} from "jotai-immer"

const baseSessionExistsAtom = atom(false)
export const sessionExistsAtom = withImmer(baseSessionExistsAtom)

const baseSessionLoadingAtom = atom(true)
export const sessionLoadingAtom = withImmer(baseSessionLoadingAtom)

export type AuthFlowState = "authed" | "unauthed" | "authing"
const baseAuthFlowAtom = atom<AuthFlowState>("unauthed")
export const authFlowAtom = withImmer(baseAuthFlowAtom)

const logSession = process.env.NEXT_PUBLIC_LOG_SESSION_ATOMS === "true"
logAtom(sessionExistsAtom, "sessionExistsAtom", logSession)

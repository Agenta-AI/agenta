import {atom} from "jotai"
import {withImmer} from "jotai-immer"

import {logAtom} from "../utils/logAtom"

const baseSessionExistsAtom = atom(false)
export const sessionExistsAtom = withImmer(baseSessionExistsAtom)

const baseSessionLoadingAtom = atom(true)
export const sessionLoadingAtom = withImmer(baseSessionLoadingAtom)

const logSession = process.env.NEXT_PUBLIC_LOG_SESSION_ATOMS === "true"
logAtom(sessionExistsAtom, "sessionExistsAtom", logSession)

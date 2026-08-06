"use client"

import {useEffect} from "react"

import {useSetAtom, useAtomValue} from "jotai"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {sessionExistsAtom} from "./atoms"

export const useSessionExists = () => useAtomValue(sessionExistsAtom)

// sessionExistsAtom is a re-export of @agenta/shared/state's sessionAtom,
// so a single setter updates both oss and entity-package readers.
const SessionListener = () => {
    const {doesSessionExist} = useSessionContext() as any
    const setExists = useSetAtom(sessionExistsAtom)
    useEffect(() => {
        setExists(doesSessionExist)
    }, [doesSessionExist, setExists])
    return null
}

export default SessionListener

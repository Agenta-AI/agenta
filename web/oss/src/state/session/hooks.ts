"use client"

import {useEffect} from "react"

import {setSessionAtom} from "@agenta/shared/state"
import {useSetAtom, useAtomValue} from "jotai"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {sessionExistsAtom} from "./atoms"

export const useSessionExists = () => useAtomValue(sessionExistsAtom)

const SessionListener = () => {
    const {doesSessionExist} = useSessionContext() as any
    const setExists = useSetAtom(sessionExistsAtom)
    const setSharedSession = useSetAtom(setSessionAtom)
    useEffect(() => {
        setExists(doesSessionExist)
        setSharedSession(doesSessionExist)
    }, [doesSessionExist, setExists, setSharedSession])
    return null
}

export default SessionListener

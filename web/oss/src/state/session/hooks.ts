"use client"

import {useEffect} from "react"

import {useSetAtom, useAtomValue} from "jotai"
import {useSessionContext} from "supertokens-auth-react/recipe/session"

import {sessionExistsAtom} from "./atoms"

export const useSessionExists = () => useAtomValue(sessionExistsAtom)

const SessionListener = () => {
    const {doesSessionExist} = useSessionContext() as any
    const setExists = useSetAtom(sessionExistsAtom)
    useEffect(() => {
        setExists(doesSessionExist)
    }, [doesSessionExist, setExists])
    return null
}

export default SessionListener

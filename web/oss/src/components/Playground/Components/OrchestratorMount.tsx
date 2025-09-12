"use client"
import {useEffect} from "react"

import {useAtomValue} from "jotai"

import {runLifecycleOrchestratorAtom} from "@/oss/components/Playground/state/atoms/orchestration/runLifecycle"

/**
 * Mounts the runLifecycleOrchestratorAtom on the client so its onMount handler runs.
 * Renders nothing.
 */
export default function OrchestratorMount() {
    // Subscribing via useAtomValue ensures the atom is mounted in the client store
    // useAtomValue(runLifecycleOrchestratorAtom)

    // // Optional: client-side confirmation
    // useEffect(() => {
    //     if (process.env.NODE_ENV !== "production") {
    //         console.debug("[OrchestratorMount] Mounted")
    //     }
    // }, [])

    return null
}

/**
 * Web Worker Derived Listener
 *
 * This derived listener initializes the web worker once and handles all web worker
 * communication centrally. This prevents multiple usePlaygroundAtoms instances
 * from creating conflicting web worker listeners.
 */

import {atom} from "jotai"

import useWebWorker from "../../hooks/useWebWorker"

import {handleWebWorkerResultAtom} from "./webWorkerIntegration"

// Atom to track if web worker is initialized
export const webWorkerInitializedAtom = atom(false)

// Derived listener that initializes web worker once
export const webWorkerDerivedListenerAtom = atom(
    (get) => get(webWorkerInitializedAtom),
    (get, set) => {
        // This will be called once when the listener is first accessed
        const handleWebWorkerResult = (message: any) => {
            set(handleWebWorkerResultAtom, message)
        }

        // Initialize web worker with global handler
        const {postMessageToWorker, createWorkerMessage} = useWebWorker(
            handleWebWorkerResult,
            true, // Enable listening for messages
        )

        // Mark as initialized
        set(webWorkerInitializedAtom, true)

        // Return the web worker functions for use by other atoms
        return {
            postMessageToWorker,
            createWorkerMessage,
        }
    },
)

import {atom, createStore} from "jotai"

import type {ConfigMetadata} from "../assets/utilities/genericTransformer/types"
import {EnhancedVariant, TestResult} from "../assets/utilities/transformer/types"

import {InitialStateType} from "./types"

// Create an atom store
export const atomStore = createStore()

// Atom to store responses
export const responseAtom = atom<Record<string, TestResult>>({})
export const getResponseLazy = <T extends TestResult>(
    hash?: string | TestResult | null,
): T | null => {
    if (!hash) return null
    if (typeof hash !== "string") {
        return hash as T
    }

    return (atomStore.get(responseAtom)[hash] as T) || null
}
export const getAllResponses = (): Record<string, TestResult> => {
    return atomStore.get(responseAtom) || {}
}
export const updateResponseAtom = async (metadata: Record<string, any>) => {
    atomStore.set(responseAtom, (prev) => ({...prev, ...metadata}))
}

class TaskQueue {
    private queue: Promise<void> = Promise.resolve()

    enqueue(task: () => Promise<void>): Promise<void> {
        // Chain the task to the existing queue
        const nextTask = this.queue.then(() => task())
        this.queue = nextTask.catch((error) => {
            console.error("TaskQueue error:", error)
        }) // Catch errors to avoid breaking the chain
        return nextTask
    }
}

const metadataQueue = new TaskQueue()

// Atom to store metadata
export const metadataAtom = atom<Record<string, ConfigMetadata>>({})
// Lazy reader for metadata
export const getMetadataLazy = <T extends ConfigMetadata>(hash?: string | T): T | null => {
    if (!hash) return null
    if (typeof hash !== "string") {
        return hash as T
    }

    return (atomStore.get(metadataAtom)[hash] as T) || null
}
export const getAllMetadata = (): Record<string, ConfigMetadata> => {
    return atomStore.get(metadataAtom) || {}
}

export const updateMetadataAtom = async (metadata: Record<string, any>) => {
    atomStore.set(metadataAtom, (prev) => ({...prev, ...metadata}))
    await metadataQueue.enqueue(
        () =>
            new Promise<void>((resolve) => {
                atomStore.set(metadataAtom, (prev) => ({...prev, ...metadata}))
                resolve()
            }),
    )
}

// Atom to store variantsRef
export const variantsRefAtom = atom<Record<string, EnhancedVariant>>({})
// Lazy reader for variantsRef
export const getVariantsLazy = <T extends EnhancedVariant>(hash?: string): T | null => {
    if (!hash) return null

    return (atomStore.get(variantsRefAtom)[hash] as T) || null
}
export const getAllVariants = (): Record<string, EnhancedVariant> => {
    return atomStore.get(variantsRefAtom) || {}
}

export const updateVariantsRefAtom = async (metadata: Record<string, any>) => {
    atomStore.set(variantsRefAtom, (prev) => ({...prev, ...metadata}))
}

// Atom to store openapi spec json
export const specAtom = atom<InitialStateType["spec"]>(undefined)
// Lazy reader for spec
export const getSpecLazy = () => {
    return atomStore.get(specAtom) || null
}

// SWR Cache State
export const initialState: InitialStateType = {
    variants: [],
    selected: [],
    uri: undefined,
    dirtyStates: {},
    generationData: {
        messages: {} as InitialStateType["generationData"]["messages"],
        inputs: {} as InitialStateType["generationData"]["inputs"],
    } as InitialStateType["generationData"],
}

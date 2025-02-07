import {InitialStateType} from "./types"
import {atom, createStore} from "jotai"

import type {ConfigMetadata} from "../assets/genericTransformer/types"

// Create an atom store
export const atomStore = createStore()

// Atom to store metadata
export const metadataAtom = atom<Record<string, ConfigMetadata>>({})
// Lazy reader for metadata
export const getMetadataLazy = <T extends ConfigMetadata>(hash?: string): T | null => {
    if (!hash) return null

    return (atomStore.get(metadataAtom)[hash] as T) || null
}
export const getAllMetadata = (): Record<string, ConfigMetadata> => {
    return atomStore.get(metadataAtom) || {}
}

export const updateMetadataAtom = async (metadata: Record<string, any>) => {
    atomStore.set(metadataAtom, (prev) => ({...prev, ...metadata}))
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
    dirtyStates: {},
    generationData: {
        messages: {} as InitialStateType["generationData"]["messages"],
        inputs: {} as InitialStateType["generationData"]["inputs"],
    } as InitialStateType["generationData"],
}

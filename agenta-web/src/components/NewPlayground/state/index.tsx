import {InitialStateType} from "./types"
import {atom, createStore} from "jotai"

// Create an atom store
export const atomStore = createStore()

// Atom to store metadata
export const metadataAtom = atom<Record<string, unknown>>({})
// Lazy reader for metadata
export const getMetadataLazy = (hash: string) => {
    return atomStore.get(metadataAtom)[hash] || null
}

class TaskQueue {
    private queue: Promise<void> = Promise.resolve()

    enqueue(task: () => Promise<void>): Promise<void> {
        // Chain the task to the existing queue
        const nextTask = this.queue.then(() => task())
        this.queue = nextTask.catch(() => {}) // Catch errors to avoid breaking the chain
        return nextTask
    }
}

const metadataQueue = new TaskQueue()

export const updateMetadataAtom = async (metadata: Record<string, any>) => {
    await metadataQueue.enqueue(
        () =>
            new Promise<void>((resolve) => {
                atomStore.set(metadataAtom, (prev) => ({...prev, ...metadata}))
                resolve()
            }),
    )
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
    dirtyStates: new Map<string, boolean>(),
    generationData: {} as InitialStateType["generationData"],
}

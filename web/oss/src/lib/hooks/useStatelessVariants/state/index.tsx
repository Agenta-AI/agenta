import {atom, createStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {ConfigMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {TestResult} from "@/oss/lib/shared/variant/transformer/types"

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
// Per-key selector family to avoid re-renders on unrelated keys
export const metadataSelectorFamily = atomFamily((hash: string | undefined) =>
    selectAtom(
        metadataAtom,
        (m) => (hash ? (m[hash] as ConfigMetadata | undefined) : undefined),
        Object.is,
    ),
)
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

// getSpecLazy moved to '@/oss/state/variant/atoms/fetcher'

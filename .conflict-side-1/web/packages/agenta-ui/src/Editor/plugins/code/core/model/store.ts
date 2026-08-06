import type {CodeModelOutput, CodeModelSnapshot} from "./types"

function areSnapshotsEqual(prev: CodeModelSnapshot, next: CodeModelSnapshot): boolean {
    return (
        prev.editorId === next.editorId &&
        prev.content === next.content &&
        prev.language === next.language
    )
}

export function createCodeModelOutput(initialSnapshot: CodeModelSnapshot): CodeModelOutput {
    let snapshot = initialSnapshot
    const listeners = new Set<() => void>()

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        setSnapshot: (nextSnapshot) => {
            if (areSnapshotsEqual(snapshot, nextSnapshot)) {
                return
            }

            snapshot = nextSnapshot
            listeners.forEach((listener) => listener())
        },
    }
}

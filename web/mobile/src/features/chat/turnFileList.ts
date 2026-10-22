import type {ActivityStep} from "@agenta/chat/model"
import type {FileActivity} from "@agenta/entities/session"

/** The files a turn's tool steps touched, once per path in first-seen order. A file the turn
 * created reads as created even when a later step edited it. */
export const turnFiles = (steps: readonly ActivityStep[]): FileActivity[] => {
    const byPath = new Map<string, FileActivity>()
    for (const step of steps) {
        if (step.kind !== "tool") continue
        for (const file of step.files) {
            const seen = byPath.get(file.path)
            byPath.set(file.path, seen?.op === "write" ? seen : file)
        }
    }
    return [...byPath.values()]
}

import type {ActivityStep} from "@agenta/chat/model"
import type {FileActivity} from "@agenta/entities/session"

/** A turn's touched files in first-seen order; a created file stays created through edits. */
export const turnFiles = (steps: readonly ActivityStep[]): FileActivity[] => {
    const byPath = new Map<string, FileActivity>()
    for (const step of steps) {
        if (step.kind !== "tool") continue
        for (const file of step.files) {
            const seen = byPath.get(file.path)
            byPath.set(file.path, seen?.op === "write" && file.op === "edit" ? seen : file)
        }
    }
    return [...byPath.values()]
}

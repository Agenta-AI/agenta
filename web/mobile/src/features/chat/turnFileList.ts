import type {ActivityStep} from "@agenta/chat/model"
import {AGENT_FILES_DIR} from "@agenta/entities/drive"
import {drivePathFromToolPath, type FileActivity} from "@agenta/entities/session"
import {decodeDriveHref, isExternalHref, isProtocolRelativeHref} from "@agenta/entity-ui/drive"

/** A file the answer links to that no write step saw, such as a zip a shell command built. */
export interface LinkedFile {
    op: "link"
    path: string
}

export type TurnFile = FileActivity | LinkedFile

// A markdown link, not an image; the target may sit in `<...>`, hold one `(...)` and carry a title.
const MARKDOWN_LINK =
    /(?<!!)\[[^\]\n]*\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?(?:\s+["'][^"'\n]*["'])?\s*\)/g
// Code shows a link's syntax; it does not offer the file.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

/** The drive paths an answer links to, in the order it links them. */
export const answerLinkedPaths = (texts: readonly string[]): string[] => {
    const paths = new Set<string>()
    for (const text of texts) {
        for (const match of text.replace(CODE, "").matchAll(MARKDOWN_LINK)) {
            const href = match[1]
            if (isExternalHref(href) || isProtocolRelativeHref(href)) continue
            const path = decodeDriveHref(href.split(/[?#]/)[0]).replace(/^\.\//, "")
            // A folder has no card, and a `..` segment names a file outside the drive.
            if (!path || path.endsWith("/") || path.split("/").includes("..")) continue
            paths.add(path)
        }
    }
    return [...paths]
}

/** The path as the drive presents it, so a tool path and a link to one file compare equal. */
const presentedPath = (toolPath: string): string | null => {
    const drivePath = drivePathFromToolPath(toolPath)
    if (!drivePath) return null
    return drivePath.origin === "agent" ? `${AGENT_FILES_DIR}/${drivePath.path}` : drivePath.path
}

/** A turn's written files in first-seen order (a created file stays created), then answer links. */
export const turnFiles = (
    steps: readonly ActivityStep[],
    answers: readonly string[] = [],
): TurnFile[] => {
    const byPath = new Map<string, FileActivity>()
    for (const step of steps) {
        if (step.kind !== "tool") continue
        for (const file of step.files) {
            const seen = byPath.get(file.path)
            byPath.set(file.path, seen?.op === "write" && file.op === "edit" ? seen : file)
        }
    }
    const written = new Set([...byPath.keys()].map(presentedPath).filter(Boolean))
    const linked = answerLinkedPaths(answers)
        .filter((path) => !written.has(presentedPath(path) ?? path))
        .map((path): LinkedFile => ({op: "link", path}))
    return [...byPath.values(), ...linked]
}

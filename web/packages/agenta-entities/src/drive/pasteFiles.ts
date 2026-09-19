/**
 * Reading a paste. The clipboard carries files two ways: a file copied from the OS file manager
 * arrives with its real name, while a copied image (a screenshot, a picture from a web page) arrives
 * as a bitmap the browser names `image.png` every time. The second kind gets a dated name so two
 * pastes into one folder never collide — mirroring what macOS Finder does for a pasted picture.
 */
import {type DroppedFile} from "./dropEntries"

/** The names browsers give a pasted bitmap (Chrome / Firefox / Safari), which say nothing. */
const GENERIC_NAMES = /^(image|blob|clipboard|unknown)?(\.[a-z0-9]+)?$/i

const two = (n: number) => String(n).padStart(2, "0")

/** `Pasted image 2026-09-20 at 15.30.45.png` — the extension comes from the type when the name has none. */
export const pastedFileName = (file: Pick<File, "name" | "type">, at: Date): string => {
    const extFromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]
    const extFromType = file.type.split("/")[1]?.split("+")[0]
    const ext = extFromName ?? extFromType ?? "bin"
    const kind = file.type.startsWith("image/") ? "image" : "file"
    const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} at ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`
    return `Pasted ${kind} ${stamp}.${ext}`
}

/** A pasted file's name for the drive: the real one when it has one, a dated one for a bare bitmap. */
export const nameForPastedFile = (file: Pick<File, "name" | "type">, at = new Date()): string =>
    GENERIC_NAMES.test(file.name) ? pastedFileName(file, at) : file.name

/**
 * Resolve a paste event to its files. Text-only pastes yield nothing, so the caller can leave those
 * to whatever field has focus. MUST be called synchronously from the paste handler: the item list
 * only lives for the event.
 */
export function readPastedFiles(
    clipboardData: DataTransfer | null,
    at = new Date(),
): DroppedFile[] {
    const items = Array.from(clipboardData?.items ?? []).filter((item) => item.kind === "file")
    const files = items.length
        ? items.map((item) => item.getAsFile()).filter((f): f is File => f !== null)
        : Array.from(clipboardData?.files ?? [])
    return files.map((file) => {
        const name = nameForPastedFile(file, at)
        const named = name === file.name ? file : new File([file], name, {type: file.type})
        return {file: named, relativePath: name}
    })
}

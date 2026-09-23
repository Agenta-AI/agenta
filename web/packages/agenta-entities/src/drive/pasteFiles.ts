/**
 * Reading a paste. The clipboard carries files two ways: a file copied from the OS file manager
 * arrives with its real name, while a copied image (a screenshot, a picture from a web page) arrives
 * as a bitmap the browser names `image.png` every time. The second kind gets a dated name so two
 * pastes into one folder never collide — mirroring what macOS Finder does for a pasted picture.
 *
 * An upload writes its destination name unconditionally, so a name that repeats overwrites what is
 * already there. Two spellings of that risk are handled here: a real file that happens to be called
 * `image.png` keeps its name (it is only the browser's bitmap that gets dated), and names that
 * repeat inside one paste are numbered apart.
 */
import {type DroppedFile} from "./dropEntries"

/** What naming a pasted file needs: a File, or the same fields from a test. */
type PastedFileMeta = Pick<File, "name" | "type"> & {lastModified?: number}

/** The names browsers give a pasted bitmap (Chrome / Firefox / Safari), which say nothing. */
const GENERIC_NAMES = /^(image|blob|clipboard|unknown)?(\.[a-z0-9]+)?$/i

/** How fresh a file's mtime must be to read as one the browser just made for this paste. A file
 * copied in Finder carries the mtime it has on disk, which is almost always older than this. */
const SYNTHESIZED_WINDOW_MS = 10_000

const two = (n: number) => String(n).padStart(2, "0")

/** `Pasted image 2026-09-20 at 15.30.45.png` — the extension comes from the type when the name has none. */
export const pastedFileName = (file: PastedFileMeta, at: Date): string => {
    const extFromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]
    const extFromType = file.type.split("/")[1]?.split("+")[0]
    const ext = extFromName ?? extFromType ?? "bin"
    const kind = file.type.startsWith("image/") ? "image" : "file"
    const stamp = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} at ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`
    return `Pasted ${kind} ${stamp}.${ext}`
}

/** True for a bitmap the browser made for this paste, rather than a file copied from disk: it has
 * no mtime of its own, or one from the moment of the paste. */
const isSynthesized = (file: PastedFileMeta, at: Date): boolean =>
    file.lastModified === undefined || file.lastModified >= at.getTime() - SYNTHESIZED_WINDOW_MS

/** A pasted file's name for the drive: the real one when it has one, a dated one for a bare bitmap.
 * A file the OS copied keeps its name even when that name is `image.png`. */
export const nameForPastedFile = (file: PastedFileMeta, at = new Date()): string =>
    GENERIC_NAMES.test(file.name) && isSynthesized(file, at) ? pastedFileName(file, at) : file.name

/** `a.png` → `a 2.png` → `a 3.png` until the name is free. Two images pasted together share a
 * dated name to the second, and two files copied together can share a real one. */
const distinctFrom = (name: string, taken: Set<string>): string => {
    if (!taken.has(name)) return name
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ""
    let n = 2
    while (taken.has(`${stem} ${n}${ext}`)) n += 1
    return `${stem} ${n}${ext}`
}

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
    const taken = new Set<string>()
    return files.map((file) => {
        const name = distinctFrom(nameForPastedFile(file, at), taken)
        taken.add(name)
        const named = name === file.name ? file : new File([file], name, {type: file.type})
        return {file: named, relativePath: name}
    })
}

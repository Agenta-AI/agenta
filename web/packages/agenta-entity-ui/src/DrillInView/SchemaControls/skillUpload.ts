/**
 * skillUpload
 *
 * Turns an uploaded skill — a folder, a set of loose files, or a `.zip` / `.skill` archive —
 * into the inline `SkillConfigSchema` shape: `name` + `description` (parsed from the SKILL.md
 * YAML frontmatter), `body` (the Markdown after the frontmatter), and `files[]` (the supporting
 * files laid beside SKILL.md, by relative path). Pure helpers, unit-testable without the DOM,
 * plus a small DataTransfer reader for drag-and-dropped folders.
 *
 * Frontmatter mapping note: the schema keeps `name`/`description` as discrete fields (the backend
 * composes the SKILL.md frontmatter from them), so we parse those OUT of an uploaded SKILL.md and
 * keep only the body. `version` (present in some early mockups) has no schema home and is dropped.
 */
import {strFromU8, unzipSync} from "fflate"

export interface SkillFileEntry {
    path: string
    content: string
    executable?: boolean
}

export interface ParsedSkill {
    name?: string
    description?: string
    body: string
    files: SkillFileEntry[]
}

interface RawFile {
    path: string
    bytes: Uint8Array
}

const SKILL_MD = /(^|\/)SKILL\.md$/i
const ARCHIVE_EXT = /\.(zip|skill)$/i
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|\.git\/)/

/** Parse the SKILL.md YAML frontmatter into `name` / `description`, returning the body without it. */
export function parseSkillMarkdown(md: string): {
    name?: string
    description?: string
    body: string
} {
    const clean = md.replace(/^\uFEFF/, "")
    const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!m) return {body: clean.trim()}
    const fm = m[1] ?? ""
    const body = (m[2] ?? "").replace(/^[\r\n]+/, "")
    const read = (key: string): string | undefined => {
        const r = fm.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "im"))
        if (!r) return undefined
        const v = r[1].trim().replace(/^["']|["']$/g, "")
        return v || undefined
    }
    return {name: read("name"), description: read("description"), body}
}

/** Build a skill object from a flat set of files (archives already expanded). */
export function buildSkillFromFiles(raw: RawFile[]): ParsedSkill {
    const files = raw.filter((f) => f.bytes && !f.path.endsWith("/") && !IGNORED.test(f.path))
    const skillFile = files.find((f) => SKILL_MD.test(f.path))
    const md = skillFile ? strFromU8(skillFile.bytes) : ""
    const {name, description, body} = parseSkillMarkdown(md)
    // Strip the folder SKILL.md lives in, so bundled paths are relative to it.
    const baseDir = skillFile ? skillFile.path.replace(/SKILL\.md$/i, "") : ""
    const bundled: SkillFileEntry[] = files
        .filter((f) => f !== skillFile)
        .map((f) => {
            const rel =
                baseDir && f.path.startsWith(baseDir) ? f.path.slice(baseDir.length) : f.path
            return {path: rel, content: strFromU8(f.bytes)}
        })
        .filter((f) => f.path)
    return {name, description, body, files: bundled}
}

/** Expand any `.zip` / `.skill` archives into their entries; pass other files through. */
function expandArchives(raw: RawFile[]): RawFile[] {
    const out: RawFile[] = []
    for (const f of raw) {
        if (ARCHIVE_EXT.test(f.path)) {
            try {
                const entries = unzipSync(f.bytes)
                for (const [path, bytes] of Object.entries(entries)) {
                    out.push({path, bytes: bytes as Uint8Array})
                }
                continue
            } catch {
                // Not a valid archive — fall through and treat it as a normal file.
            }
        }
        out.push(f)
    }
    return out
}

/** Read a FileList / File[] into raw bytes, honoring `webkitRelativePath` for folder picks. */
async function filesToRaw(list: FileList | File[]): Promise<RawFile[]> {
    return Promise.all(
        Array.from(list).map(async (file) => ({
            path: (file as File & {webkitRelativePath?: string}).webkitRelativePath || file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
        })),
    )
}

/** Recursively read one drag-and-drop FileSystemEntry (folder or file) into raw files. */
async function readEntry(entry: FileSystemEntry, prefix: string, out: RawFile[]): Promise<void> {
    if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        const file = await new Promise<File>((res, rej) => fileEntry.file(res, rej))
        out.push({
            path: prefix + entry.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
        })
        return
    }
    const dirReader = (entry as FileSystemDirectoryEntry).createReader()
    const children = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        const all: FileSystemEntry[] = []
        const pump = () =>
            dirReader.readEntries((batch) => {
                if (!batch.length) resolve(all)
                else {
                    all.push(...batch)
                    pump()
                }
            }, reject)
        pump()
    })
    for (const child of children) {
        await readEntry(child, `${prefix}${entry.name}/`, out)
    }
}

/** Read a drop's DataTransfer (folders via the entries API, else plain files). */
async function readDataTransfer(dt: DataTransfer): Promise<RawFile[]> {
    const entries = Array.from(dt.items)
        .filter((i) => i.kind === "file")
        .map((i) => i.webkitGetAsEntry?.())
        .filter((e): e is FileSystemEntry => Boolean(e))
    if (entries.length) {
        const out: RawFile[] = []
        for (const e of entries) await readEntry(e, "", out)
        return out
    }
    return filesToRaw(dt.files)
}

/** Top-level: a selected FileList → a parsed skill. */
export async function parseSkillFromFileList(list: FileList | File[]): Promise<ParsedSkill> {
    return buildSkillFromFiles(expandArchives(await filesToRaw(list)))
}

/** Top-level: a drop's DataTransfer → a parsed skill. */
export async function parseSkillFromDataTransfer(dt: DataTransfer): Promise<ParsedSkill> {
    return buildSkillFromFiles(expandArchives(await readDataTransfer(dt)))
}

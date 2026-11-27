// Reads an uploaded skill (folder, loose files, or a .zip / .skill archive) into the skill shape.
import {strFromU8, unzipSync} from "fflate"
import {load as loadYaml} from "js-yaml"

import {skillFilesOf} from "./skillFiles"

export interface SkillFileEntry {
    path: string
    content: string
    executable?: boolean
}

export interface ParsedSkill {
    name?: string
    description?: string
    disable_model_invocation?: boolean
    body: string
    files: SkillFileEntry[]
}

interface RawFile {
    path: string
    bytes: Uint8Array
    executable?: boolean
}

const SKILL_MD = /(^|\/)SKILL\.md$/i
const ARCHIVE_EXT = /\.(zip|skill)$/i
const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|\.git\/)/

/** Parse the SKILL.md YAML frontmatter into `name` / `description`, returning the body without it. */
export function parseSkillMarkdown(md: string): {
    name?: string
    description?: string
    disable_model_invocation?: boolean
    body: string
} {
    const clean = md.replace(/^\uFEFF/, "")
    const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
    if (!m) return {body: clean.trim()}
    const fm = m[1] ?? ""
    const body = (m[2] ?? "").replace(/^[\r\n]+/, "").trimEnd()
    let metadata: unknown
    try {
        metadata = loadYaml(fm)
    } catch {
        return {body}
    }
    const record =
        metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>)
            : {}
    const read = (key: string): string | undefined => {
        const value = record[key]
        if (typeof value !== "string") return undefined
        return value.trim() || undefined
    }
    return {
        name: read("name"),
        description: read("description"),
        // The frontmatter key the runner writes and the backend parser reads.
        ...(record["disable-model-invocation"] === true ? {disable_model_invocation: true} : {}),
        body,
    }
}

/** Build a skill object from a flat set of files (archives already expanded). */
export function buildSkillFromFiles(raw: RawFile[]): ParsedSkill {
    const files = raw.filter((f) => f.bytes && !f.path.endsWith("/") && !IGNORED.test(f.path))
    const skillFile = files.find((f) => SKILL_MD.test(f.path))
    const md = skillFile ? strFromU8(skillFile.bytes) : ""
    const {name, description, disable_model_invocation, body} = parseSkillMarkdown(md)
    // Strip the folder SKILL.md lives in, so bundled paths are relative to it.
    const baseDir = skillFile ? skillFile.path.replace(/SKILL\.md$/i, "") : ""
    const bundled: SkillFileEntry[] = files
        .filter((f) => f !== skillFile)
        .map((f) => {
            const rel =
                baseDir && f.path.startsWith(baseDir) ? f.path.slice(baseDir.length) : f.path
            return {
                path: rel,
                content: strFromU8(f.bytes),
                ...(f.executable ? {executable: true} : {}),
            }
        })
        .filter((f) => f.path)
    return {
        name,
        description,
        ...(disable_model_invocation ? {disable_model_invocation} : {}),
        body,
        files: bundled,
    }
}

interface ZipEntry {
    name: string
    /** A Unix entry with an execute bit in its mode. */
    executable: boolean
}

/** The entries of a zip, repeats included, read from its central directory. */
function zipEntries(bytes: Uint8Array): ZipEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // The end-of-directory record: the last 22 bytes, before any archive comment.
    let end = bytes.length - 22
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
    if (end < 0) return []
    const entries: ZipEntry[] = []
    let at = view.getUint32(end + 16, true)
    for (let n = view.getUint16(end + 10, true); n > 0; n--) {
        if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) break
        const nameLength = view.getUint16(at + 28, true)
        // As fflate: a name without the UTF-8 flag (bit 11) is read as Latin-1.
        const latin1 = !(view.getUint16(at + 8, true) & 0x0800)
        // Made on Unix (host 3): the high 16 bits of the external attributes are the file mode.
        const unix = view.getUint8(at + 5) === 3
        const mode = view.getUint32(at + 38, true) >>> 16
        entries.push({
            name: strFromU8(bytes.subarray(at + 46, at + 46 + nameLength), latin1),
            executable: unix && (mode & 0o111) !== 0,
        })
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    }
    return entries
}

/** A name that an archive in the upload holds twice; unzipping keeps only one of the two. */
function repeatedArchivePath(raw: RawFile[]): string | undefined {
    for (const f of raw) {
        if (!ARCHIVE_EXT.test(f.path)) continue
        // Folders and ignored files never reach the skill, so their repeats do not count.
        const names = zipEntries(f.bytes)
            .map((entry) => entry.name)
            .filter((name) => !name.endsWith("/") && !IGNORED.test(name))
        const repeated = names.find((name, i) => names.indexOf(name) !== i)
        if (repeated !== undefined) return repeated
    }
    return undefined
}

/** Expand any `.zip` / `.skill` archives into their entries; throws when one cannot be read. */
function expandArchives(raw: RawFile[]): RawFile[] {
    const out: RawFile[] = []
    for (const f of raw) {
        if (!ARCHIVE_EXT.test(f.path)) {
            out.push(f)
            continue
        }
        const entries = unzipSync(f.bytes)
        const executable = new Set(
            zipEntries(f.bytes)
                .filter((entry) => entry.executable)
                .map((entry) => entry.name),
        )
        for (const [path, bytes] of Object.entries(entries)) {
            out.push({
                path,
                bytes: bytes as Uint8Array,
                ...(executable.has(path) ? {executable: true} : {}),
            })
        }
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

/** Merge a pasted SKILL.md into a draft: name, description and body; `files` stay. */
export function mergePastedSkill(
    skill: Record<string, unknown>,
    md: string,
): Record<string, unknown> {
    const {name, description, disable_model_invocation, body} = parseSkillMarkdown(md)
    const next: Record<string, unknown> = {...skill, body}
    if (name) next.name = name
    if (description) next.description = description
    if (disable_model_invocation) next.disable_model_invocation = true
    return next
}

/** Top-level: a selected FileList → a parsed skill. */
export async function parseSkillFromFileList(list: FileList | File[]): Promise<ParsedSkill> {
    return buildSkillFromFiles(expandArchives(await filesToRaw(list)))
}

/** Top-level: a drop's DataTransfer → a parsed skill. */
export async function parseSkillFromDataTransfer(dt: DataTransfer): Promise<ParsedSkill> {
    return buildSkillFromFiles(expandArchives(await readDataTransfer(dt)))
}

// ---------------------------------------------------------------------------
// Multi-candidate scan (the upload drawer's 1c/1d/1e states)
// ---------------------------------------------------------------------------

export interface SkillScanCandidate {
    /** Unique per candidate, even when two loose SKILL.md files share a folder. Key rows by it. */
    key: string
    /** SKILL.md's directory, "" at the upload root. Doubles as the row label. */
    dir: string
    skill: ParsedSkill
}

export interface SkillUploadScan {
    /** One entry per SKILL.md found; empty = nothing importable (the invalid state). */
    candidates: SkillScanCandidate[]
    /** Files skipped with a reason ("binary", "too large") — the gold warnings. */
    skipped: {path: string; reason: string}[]
    /** Total files considered, for the "N files parsed" tag. */
    fileCount: number
}

/** Mirror of the SDK's per-file content cap (SkillFile.content max_length). */
const FILE_CONTENT_MAX = 200_000

/** A NUL byte in the first 4KB marks binary content — decoding it would mojibake. */
const looksBinary = (bytes: Uint8Array): boolean => {
    const probe = bytes.subarray(0, 4096)
    for (const b of probe) if (b === 0) return true
    return false
}

/** The files of an upload, split into the text files and the files skipped with a reason. */
function splitTextFiles(raw: RawFile[]): {
    files: RawFile[]
    usable: RawFile[]
    skipped: {path: string; reason: string}[]
} {
    const files = raw.filter((f) => f.bytes && !f.path.endsWith("/") && !IGNORED.test(f.path))
    const skipped: {path: string; reason: string}[] = []
    const usable: RawFile[] = []
    for (const f of files) {
        if (looksBinary(f.bytes)) skipped.push({path: f.path, reason: "binary"})
        else if (f.bytes.length > FILE_CONTENT_MAX)
            skipped.push({path: f.path, reason: "too large"})
        else usable.push(f)
    }
    return {files, usable, skipped}
}

/** One candidate per SKILL.md in the upload; binary and oversized files are skipped with a reason. */
export function scanSkillFiles(raw: RawFile[]): SkillUploadScan {
    const {files, usable, skipped} = splitTextFiles(raw)

    const skillFiles = usable.filter((f) => SKILL_MD.test(f.path))
    // Every SKILL.md, skipped ones too, fences its folder off from the parent skill.
    const allSkillFiles = files.filter((f) => SKILL_MD.test(f.path))
    const candidates: SkillScanCandidate[] = skillFiles.map((skillFile, index) => {
        const dir = skillFile.path.replace(/SKILL\.md$/i, "").replace(/\/$/, "")
        const prefix = dir ? `${dir}/` : ""
        // Another SKILL.md in the same folder (two loose files) is its own candidate.
        const sibling = (f: RawFile) =>
            f !== skillFile && SKILL_MD.test(f.path) && f.path.replace(/SKILL\.md$/i, "") === prefix
        // The candidate owns its subtree; a nested skill's files never leak into the parent's.
        const nestedDirs = allSkillFiles
            .filter((other) => other !== skillFile)
            .map((other) => other.path.replace(/SKILL\.md$/i, ""))
            .filter((otherPrefix) => otherPrefix.startsWith(prefix) && otherPrefix !== prefix)
        const scope = usable.filter(
            (f) =>
                f.path.startsWith(prefix) &&
                !sibling(f) &&
                !nestedDirs.some((nested) => f.path.startsWith(nested)),
        )
        return {key: `${index}:${skillFile.path}`, dir, skill: buildSkillFromFiles(scope)}
    })

    return {candidates, skipped, fileCount: files.length}
}

/** Top-level: a selected FileList → the multi-candidate scan. */
export async function scanSkillFromFileList(list: FileList | File[]): Promise<SkillUploadScan> {
    return scanSkillFiles(expandArchives(await filesToRaw(list)))
}

/** Top-level: a drop's DataTransfer → the multi-candidate scan. */
export async function scanSkillFromDataTransfer(dt: DataTransfer): Promise<SkillUploadScan> {
    return scanSkillFiles(expandArchives(await readDataTransfer(dt)))
}

// ---------------------------------------------------------------------------
// Upload into an open skill: "Add to this skill" or "Replace the whole skill"
// ---------------------------------------------------------------------------

/** An upload read for the skill view: the text files as a skill, and the files left out. */
export interface SkillUpload {
    /** The upload held a SKILL.md (as text). */
    hasSkillMd: boolean
    /** It held more than one, so it is more than one skill. */
    manySkills?: boolean
    /** A path two uploaded files share: one would silently replace the other. */
    duplicatePath?: string
    skill: ParsedSkill
    /** Files that are not text, or too large, with the reason. */
    skipped: {path: string; reason: string}[]
}

/** Split an upload into its text files and the files that are skipped. */
export function readSkillUpload(raw: RawFile[], repeatedPath?: string): SkillUpload {
    const {files, usable, skipped} = splitTextFiles(raw)
    const skill = buildSkillFromFiles(usable)
    const paths = skill.files.map((file) => file.path)
    return {
        hasSkillMd: usable.some((f) => SKILL_MD.test(f.path)),
        // A skipped SKILL.md still marks a second skill, as in `scanSkillFiles`.
        manySkills: files.filter((f) => SKILL_MD.test(f.path)).length > 1,
        duplicatePath: repeatedPath ?? paths.find((path, i) => paths.indexOf(path) !== i),
        skill,
        skipped,
    }
}

/** Top-level: a selected FileList → an upload for the skill view. */
export async function readSkillUploadFromFileList(list: FileList | File[]): Promise<SkillUpload> {
    const raw = await filesToRaw(list)
    return readSkillUpload(expandArchives(raw), repeatedArchivePath(raw))
}

/** Top-level: a drop's DataTransfer → an upload for the skill view. */
export async function readSkillUploadFromDataTransfer(dt: DataTransfer): Promise<SkillUpload> {
    const raw = await readDataTransfer(dt)
    return readSkillUpload(expandArchives(raw), repeatedArchivePath(raw))
}

export type SkillUploadMode = "add" | "replace"

/** Apply an upload to the draft: "add" merges files only; "replace" takes the whole skill. */
export function applySkillUpload(
    skill: Record<string, unknown>,
    upload: SkillUpload,
    mode: SkillUploadMode,
):
    | {skill: Record<string, unknown>}
    | {error: "noSkillMd" | "manySkills"}
    | {error: "duplicatePath"; path: string} {
    const parsed = upload.skill
    if (upload.duplicatePath !== undefined)
        return {error: "duplicatePath", path: upload.duplicatePath}
    if (mode === "add") {
        const files = [...skillFilesOf(skill)]
        for (const file of parsed.files) {
            const at = files.findIndex((entry) => entry.path === file.path)
            if (at === -1) files.push(file)
            // The uploaded text replaces the file; its executable mark stays.
            else files[at] = {...files[at], content: file.content}
        }
        const next = {...skill}
        if (files.length) next.files = files
        else delete next.files
        return {skill: next}
    }
    if (!upload.hasSkillMd) return {error: "noSkillMd"}
    // Replace takes one skill; the files of a second one would land in this one.
    if (upload.manySkills) return {error: "manySkills"}
    const next: Record<string, unknown> = {...skill, body: parsed.body}
    // As production: a SKILL.md with no name or description keeps the ones the skill has.
    if (parsed.name) next.name = parsed.name
    if (parsed.description) next.description = parsed.description
    if (parsed.files.length) next.files = parsed.files
    else delete next.files
    if (parsed.disable_model_invocation) next.disable_model_invocation = true
    else delete next.disable_model_invocation
    return {skill: next}
}

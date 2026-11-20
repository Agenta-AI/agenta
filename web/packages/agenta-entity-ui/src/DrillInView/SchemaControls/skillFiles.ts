/**
 * The bundled files of a skill as the skill view's file menu shows them: folders from the paths,
 * search, the per-file path check, and which files have unsaved edits. Pure, no React.
 */
import type {SkillFileEntry} from "./skillUpload"

/** The SDK's bundled-path rules: relative, no empty, "." or ".." segment, not SKILL.md. */
export const isSafeSkillPath = (path: string): boolean =>
    Boolean(path) &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes("\\") &&
    !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") &&
    path.toLowerCase() !== "skill.md"

/** The bundled files of a skill value; a value from the JSON view may hold anything. */
export const skillFilesOf = (skill: Record<string, unknown>): SkillFileEntry[] =>
    Array.isArray(skill.files) ? (skill.files as SkillFileEntry[]) : []

export const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1)
export const fileFolder = (path: string): string =>
    path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

export type FilePathProblem = "empty" | "skillMd" | "invalid" | "duplicate"

/**
 * Why the path of file `index` cannot be saved, or undefined. Two files of one skill never share a
 * path: the later one is refused, so the earlier file stays as it is.
 */
export function filePathProblem(
    files: SkillFileEntry[],
    index: number,
): FilePathProblem | undefined {
    const path = files[index]?.path ?? ""
    if (!path.trim()) return "empty"
    if (path.toLowerCase() === "skill.md") return "skillMd"
    if (!isSafeSkillPath(path)) return "invalid"
    if (files.some((file, i) => i !== index && file.path === path)) return "duplicate"
    return undefined
}

/** The first file whose path cannot be saved; Save stays off while there is one. */
export const firstBadFile = (files: SkillFileEntry[]): number | undefined => {
    const index = files.findIndex((_, i) => filePathProblem(files, i) !== undefined)
    return index === -1 ? undefined : index
}

export interface FileMenuFolder {
    /** The folder path, "" for the files at the skill root. */
    folder: string
    /** Indexes into the skill's `files`, in the order of the list. */
    files: number[]
}

/**
 * The files grouped by folder: the root files first, then each folder in the order its first file
 * appears. A folder in a path ("references/pricing.md") is a group; there are no empty folders.
 */
export function groupFilesByFolder(files: SkillFileEntry[]): FileMenuFolder[] {
    const groups = new Map<string, number[]>([["", []]])
    files.forEach((file, index) => {
        const folder = fileFolder(file.path)
        const group = groups.get(folder)
        if (group) group.push(index)
        else groups.set(folder, [index])
    })
    return [...groups].map(([folder, indexes]) => ({folder, files: indexes}))
}

/** The files whose name or folder holds `query` (case does not matter), in list order. */
export function searchFiles(files: SkillFileEntry[], query: string): number[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    return groupFilesByFolder(files)
        .flatMap((group) => group.files)
        .filter((index) => (files[index]?.path ?? "").toLowerCase().includes(needle))
}

const SKILL_MD_FIELDS = [
    "name",
    "description",
    "body",
    "disable_model_invocation",
    "allow_executable_files",
] as const

/** SKILL.md has unsaved edits: its text, its name, its description or a switch changed. */
export const skillMdEdited = (
    value: Record<string, unknown>,
    baseline: Record<string, unknown>,
): boolean => SKILL_MD_FIELDS.some((key) => (value[key] ?? null) !== (baseline[key] ?? null))

/** File `index` is new, renamed or changed since `baseline` (the saved files). */
export const fileEdited = (
    files: SkillFileEntry[],
    index: number,
    baseline: SkillFileEntry[],
): boolean => {
    const file = files[index]
    if (!file) return false
    const saved = baseline.find((entry) => entry.path === file.path)
    return (
        !saved ||
        saved.content !== file.content ||
        Boolean(saved.executable) !== Boolean(file.executable)
    )
}

/** How many files the bar counts as edited: SKILL.md and each bundled file with a dot. */
export const editedFileCount = (
    value: Record<string, unknown>,
    baseline: Record<string, unknown>,
): number => {
    const files = skillFilesOf(value)
    const saved = skillFilesOf(baseline)
    return (
        (skillMdEdited(value, baseline) ? 1 : 0) +
        files.filter((_, index) => fileEdited(files, index, saved)).length
    )
}

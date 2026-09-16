/**
 * Pure file-kind resolution for the drive surfaces — extension → kind / language / type label /
 * tone. Deliberately its OWN light module (no React, no renderers, no Markdown/Shiki): the icon
 * helper, the type mark, thumbnails, and the config file list all need `resolveDriveFileKind` but
 * must NOT pull the heavy renderer graph. The renderers import from here, not the other way around.
 */
import {isMarkdownPath} from "./driveTree"

export type DriveFileKind =
    | "markdown"
    | "text"
    | "code"
    | "json"
    | "csv"
    | "html"
    | "image"
    | "pdf"
    | "audio"
    | "video"
    | "other"

// Extension → Shiki language id for the code body (the lexical CodeBlock normalizes further;
// unknown ids degrade to plaintext, never a broken viewer).
const CODE_LANGS: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    sh: "shellscript",
    bash: "shellscript",
    zsh: "shellscript",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    php: "php",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    kt: "kotlin",
    swift: "swift",
    sql: "sql",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    xml: "xml",
    toml: "toml",
    ini: "ini",
    conf: "ini",
    cfg: "ini",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",
    dart: "dart",
    scala: "scala",
    lua: "lua",
    r: "r",
    pl: "perl",
    ps1: "powershell",
    bat: "bat",
    graphql: "graphql",
    gql: "graphql",
    proto: "proto",
    tf: "terraform",
    rst: "rst",
}

// Extensionless files that are code — matched on the leaf name, case-insensitive.
const CODE_NAMES: Record<string, string> = {
    dockerfile: "docker",
    makefile: "makefile",
    justfile: "makefile",
}

// Extensionless / dot files that are plain text (a repo's usual passengers).
const TEXT_NAMES = new Set([
    "license",
    "readme",
    "changelog",
    "authors",
    "contributing",
    "notice",
    "procfile",
    ".gitignore",
    ".gitattributes",
    ".dockerignore",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    ".eslintrc",
])

const leafOf = (path: string): string => (path.split("/").pop() ?? path).toLowerCase()

export const driveCodeLanguage = (path: string): string => {
    if (/\.(json|ipynb)$/i.test(path)) return "json"
    if (/\.(yaml|yml)$/i.test(path)) return "yaml"
    const leaf = leafOf(path)
    if (CODE_NAMES[leaf]) return CODE_NAMES[leaf]
    const ext = leaf.split(".").pop() ?? ""
    return CODE_LANGS[ext] ?? "plaintext"
}

const EXT_KINDS: [RegExp, DriveFileKind][] = [
    [/\.(md|markdown|mdx)$/i, "markdown"],
    [/\.(txt|text|log|jsonl|ndjson)$/i, "text"],
    // `.env` and every `.env.<name>` variant.
    [/(^|\/)\.env(\.[\w.-]+)?$/i, "text"],
    [/\.(json|yaml|yml|ipynb)$/i, "json"],
    [/\.(csv|tsv)$/i, "csv"],
    // Own kind (renders in a sandboxed iframe); still highlighted as html in the source toggle.
    [/\.html?$/i, "html"],
    [/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i, "image"],
    [/\.pdf$/i, "pdf"],
    [/\.(mp3|wav|m4a|ogg|oga|flac|aac|opus|weba)$/i, "audio"],
    [/\.(mp4|m4v|mov|webm|mkv|ogv)$/i, "video"],
]

const CODE_EXT = new RegExp(`\\.(${Object.keys(CODE_LANGS).join("|")})$`, "i")

/** Extension-based kind resolution; first hit wins, no match → "other" (DownloadCard). */
export function resolveDriveFileKind(path: string): DriveFileKind {
    for (const [test, kind] of EXT_KINDS) if (test.test(path)) return kind
    if (CODE_EXT.test(path)) return "code"
    const leaf = leafOf(path)
    if (CODE_NAMES[leaf]) return "code"
    if (TEXT_NAMES.has(leaf)) return "text"
    return "other"
}

// Extension → human label where the bare extension reads poorly.
const EXT_LABELS: Record<string, string> = {
    py: "Python",
    ts: "TypeScript",
    tsx: "TypeScript",
    js: "JavaScript",
    jsx: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    rb: "Ruby",
    rs: "Rust",
    go: "Go",
    kt: "Kotlin",
    cs: "C#",
    cpp: "C++",
    sh: "Shell",
    bash: "Shell",
    zsh: "Shell",
    yml: "YAML",
    yaml: "YAML",
    ipynb: "Notebook",
    jsonl: "JSON Lines",
    ndjson: "JSON Lines",
    txt: "Text",
    text: "Text",
    log: "Log",
}

/** Human type label for a file (drawer/quick-look header, list "Type" column, row-2 badge). */
export const fileTypeLabel = (path: string): string => {
    if (isMarkdownPath(path)) return "Markdown"
    const kind = resolveDriveFileKind(path)
    if (kind === "image") return "Image"
    if (kind === "audio") return "Audio"
    if (kind === "video") return "Video"
    const leaf = leafOf(path)
    if (CODE_NAMES[leaf] || TEXT_NAMES.has(leaf)) return kind === "code" ? "Code" : "Text"
    const ext = leaf.includes(".") ? (leaf.split(".").pop() ?? "") : ""
    if (!ext) return "File"
    return EXT_LABELS[ext] ?? ext.toUpperCase()
}

// Chips for extensions too long for the mark.
const EXT_CHIPS: Record<string, string> = {
    graphql: "GQL",
    svelte: "SVLT",
    ndjson: "NDJSON",
    dockerfile: "DOCKER",
    makefile: "MAKE",
    justfile: "JUST",
}

/** Short chip text for the type mark ("MD", "JSON", "PY"); "FILE" for an unknown kind. */
export const fileTypeChip = (path: string): string => {
    if (isMarkdownPath(path)) return path.toLowerCase().endsWith(".mdx") ? "MDX" : "MD"
    const leaf = leafOf(path)
    if (CODE_NAMES[leaf]) return EXT_CHIPS[leaf] ?? "CODE"
    const ext = leaf.includes(".") ? (leaf.split(".").pop() ?? "") : ""
    if (EXT_CHIPS[ext]) return EXT_CHIPS[ext]
    if (ext && ext.length <= 5) return ext.toUpperCase()
    const kind = resolveDriveFileKind(path)
    return kind === "text" ? "TXT" : kind === "other" ? "FILE" : kind.toUpperCase().slice(0, 5)
}

/** Semantic colour family for a kind — the design's chip palette maps 1:1 onto the theme's
 * info / warning / success / error roles, with a neutral fallback. */
export type DriveKindTone = "info" | "warning" | "success" | "error" | "neutral"

export const driveKindTone = (kind: DriveFileKind, path?: string): DriveKindTone => {
    switch (kind) {
        case "markdown":
            return "info"
        case "json":
        case "image":
            return "warning"
        case "csv":
            return "success"
        case "code":
            // Python is green in the design; other languages read as neutral code.
            return path && /\.py$/i.test(path) ? "success" : "neutral"
        case "html":
        case "pdf":
            return "error"
        case "audio":
        case "video":
            return "warning"
        default:
            return "neutral"
    }
}

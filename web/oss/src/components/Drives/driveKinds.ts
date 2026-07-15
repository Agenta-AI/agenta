/**
 * Pure file-kind resolution for the drive surfaces — extension → kind / language / type label.
 * Deliberately its OWN light module (no React, no renderers, no Markdown/Shiki): the icon helper,
 * thumbnails, and the config file list all need `resolveDriveFileKind` but must NOT pull the heavy
 * renderer graph. The renderers import from here, not the other way around.
 */
import {isMarkdownPath} from "./driveTree"

export type DriveFileKind =
    | "markdown"
    | "text"
    | "code"
    | "json"
    | "csv"
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
    xml: "xml",
    toml: "toml",
    ini: "ini",
}

export const driveCodeLanguage = (path: string): string => {
    if (/\.(json)$/i.test(path)) return "json"
    if (/\.(yaml|yml)$/i.test(path)) return "yaml"
    const ext = path.split(".").pop()?.toLowerCase() ?? ""
    return CODE_LANGS[ext] ?? "plaintext"
}

const EXT_KINDS: [RegExp, DriveFileKind][] = [
    [/\.(md|markdown)$/i, "markdown"],
    [/\.(txt|log|env)$/i, "text"],
    [/\.(json|yaml|yml)$/i, "json"],
    [/\.csv$/i, "csv"],
    [/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i, "image"],
    [/\.pdf$/i, "pdf"],
    [/\.(mp3|wav|m4a|ogg|flac)$/i, "audio"],
    [/\.(mp4|mov|webm|mkv)$/i, "video"],
]

const CODE_EXT = new RegExp(`\\.(${Object.keys(CODE_LANGS).join("|")})$`, "i")

/** Extension-based kind resolution; first hit wins, no match → "other" (DownloadCard). */
export function resolveDriveFileKind(path: string): DriveFileKind {
    for (const [test, kind] of EXT_KINDS) if (test.test(path)) return kind
    if (CODE_EXT.test(path)) return "code"
    return "other"
}

/** Human type label for a file (drawer/quick-look header + metadata). */
export const fileTypeLabel = (path: string): string => {
    if (isMarkdownPath(path)) return "Markdown"
    const ext = path.split(".").pop()
    return ext && ext !== path ? ext.toUpperCase() : "File"
}

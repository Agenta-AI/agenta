/**
 * skillDownload
 *
 * The inverse of skillUpload: turns an inline `SkillTemplateSchema` skill back into the files
 * an agent tool installs (`~/.claude/skills/<name>/SKILL.md`). A skill without bundled files is
 * one `SKILL.md`; a skill with files is `<name>.zip` holding a `<name>/` folder, which the
 * upload parser reads back as the same skill.
 */
import {downloadBlob} from "@agenta/shared/utils"
import {strToU8, zipSync} from "fflate"

import {slugifySkillName} from "./skillName"

export interface SkillDownload {
    filename: string
    type: string
    content: string | Uint8Array
}

const asText = (value: unknown): string => (typeof value === "string" ? value : "")

/** SKILL.md text exactly as the runner composes it on disk (services/runner engines/skills.ts). */
export function composeSkillMarkdown(skill: Record<string, unknown>): string {
    const description = asText(skill.description).replace(/\n/g, " ").trim()
    const frontmatter = [
        "---",
        `name: ${JSON.stringify(asText(skill.name))}`,
        `description: ${JSON.stringify(description)}`,
        ...(skill.disable_model_invocation ? ["disable-model-invocation: true"] : []),
        "---",
    ].join("\n")
    return `${frontmatter}\n\n${asText(skill.body)}\n`
}

// The backend's bundled-path rules, so an unsaved draft cannot write outside the skill folder.
const isSafePath = (path: string): boolean =>
    Boolean(path) &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    path.toLowerCase() !== "skill.md"

const bundledFiles = (skill: Record<string, unknown>): {path: string; content: string}[] =>
    (Array.isArray(skill.files) ? (skill.files as unknown[]) : []).flatMap((entry) => {
        const file = (entry ?? {}) as Record<string, unknown>
        return typeof file.path === "string" &&
            isSafePath(file.path) &&
            typeof file.content === "string"
            ? [{path: file.path, content: file.content}]
            : []
    })

/** What a download of this skill holds, without building it: null when there is nothing. */
export function skillDownloadKind(skill: Record<string, unknown>): "markdown" | "zip" | null {
    if (!asText(skill.name).trim() && !asText(skill.body).trim()) return null
    return bundledFiles(skill).length ? "zip" : "markdown"
}

/** null when there is nothing to download (no name and no body). */
export function buildSkillDownload(skill: Record<string, unknown>): SkillDownload | null {
    const kind = skillDownloadKind(skill)
    if (!kind) return null
    const md = composeSkillMarkdown(skill)
    if (kind === "markdown") return {filename: "SKILL.md", type: "text/markdown", content: md}

    const name = slugifySkillName(asText(skill.name)) || "skill"
    // fflate 0.4 cannot write unix attributes, so a file's `executable` flag is not preserved.
    const entries: Record<string, Uint8Array> = {[`${name}/SKILL.md`]: strToU8(md)}
    for (const file of bundledFiles(skill)) entries[`${name}/${file.path}`] = strToU8(file.content)
    return {filename: `${name}.zip`, type: "application/zip", content: zipSync(entries)}
}

/** Download the skill in the browser; false when there is nothing to download. */
export function downloadSkill(skill: Record<string, unknown>): boolean {
    const download = buildSkillDownload(skill)
    if (!download) return false
    // A Blob takes only ArrayBuffer-backed bytes; fflate types its output as ArrayBufferLike.
    const content =
        typeof download.content === "string" ? download.content : [new Uint8Array(download.content)]
    downloadBlob(content, download.filename, download.type)
    return true
}

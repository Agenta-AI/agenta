import type {SkillOriginInfo} from "@agenta/skills"

export const skillsListHref = (base: string) => `${base}/skills`

export const skillPageHref = (base: string, workflowSlug: string) =>
    `${base}/skills/${encodeURIComponent(workflowSlug)}`

export type SkillCreateStart = "write" | "upload" | "import"

export const skillCreateHref = (base: string, start?: SkillCreateStart) =>
    `${base}/skills/new${start ? `?start=${start}` : ""}`

export const skillGithubUrl = (origin: SkillOriginInfo) =>
    `https://github.com/${origin.repository}/tree/${origin.ref || "HEAD"}/${origin.path ?? ""}`

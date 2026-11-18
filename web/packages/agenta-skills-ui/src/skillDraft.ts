import {skillDisplayName} from "@agenta/shared/utils"
import {SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, type SkillFile} from "@agenta/skills"

/** What the skill editor edits. `name` is the stored SKILL.md name the draft was loaded with. */
export interface SkillDraft {
    name: string
    title: string
    description: string
    body: string
    files: SkillFile[]
    allowExecutable: boolean
    disableModelInvocation?: boolean
}

export const EMPTY_SKILL_DRAFT: SkillDraft = {
    name: "",
    title: "",
    description: "",
    body: "",
    files: [],
    allowExecutable: false,
}

export const slugifySkillName = (title: string): string =>
    title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, SKILL_NAME_MAX)
        .replace(/-+$/g, "")

const text = (value: unknown): string => (typeof value === "string" ? value : "")

export const toSkillDraft = (skill?: Record<string, unknown> | null): SkillDraft => {
    const name = text(skill?.name)
    return {
        name,
        title: skillDisplayName(name),
        description: text(skill?.description),
        body: text(skill?.body),
        files: Array.isArray(skill?.files) ? (skill.files as SkillFile[]) : [],
        allowExecutable: Boolean(skill?.allow_executable_files),
        ...(skill?.disable_model_invocation != null
            ? {disableModelInvocation: Boolean(skill.disable_model_invocation)}
            : {}),
    }
}

/** The stored name: kept while the title still reads as it, else the title as a slug. */
export const draftSkillName = (draft: SkillDraft): string =>
    draft.name && skillDisplayName(draft.name) === draft.title.trim()
        ? draft.name
        : slugifySkillName(draft.title)

export const toSkillContent = (draft: SkillDraft): Record<string, unknown> => ({
    name: draftSkillName(draft),
    description: draft.description.trim(),
    body: draft.body,
    files: draft.files,
    allow_executable_files: draft.allowExecutable,
    ...(draft.disableModelInvocation != null
        ? {disable_model_invocation: draft.disableModelInvocation}
        : {}),
})

export const descriptionTooLong = (draft: SkillDraft): boolean =>
    draft.description.length > SKILL_DESCRIPTION_MAX

/** The first thing that blocks a save, in the words the editor shows. */
export const skillDraftProblem = (draft: SkillDraft): string | null => {
    if (!slugifySkillName(draft.title)) return "Name the skill."
    if (!draft.description.trim()) return "Add a description."
    if (descriptionTooLong(draft)) return "Shorten the description."
    if (!draft.body.trim()) return "Write the instructions."
    return null
}

export const sameSkillDraft = (a: SkillDraft, b: SkillDraft): boolean =>
    JSON.stringify(toSkillContent(a)) === JSON.stringify(toSkillContent(b))

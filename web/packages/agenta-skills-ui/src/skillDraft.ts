import {slugifySkillName} from "@agenta/entity-ui/drill-in"
import {SKILL_DESCRIPTION_MAX, SKILL_NAME_PATTERN, type SkillFile} from "@agenta/skills"

/** What the skill editor edits: the SKILL.md fields in the editor's own names. */
export interface SkillDraft {
    name: string
    description: string
    body: string
    files: SkillFile[]
    allowExecutable: boolean
    disableModelInvocation?: boolean
}

export const EMPTY_SKILL_DRAFT: SkillDraft = {
    name: "",
    description: "",
    body: "",
    files: [],
    allowExecutable: false,
}

const text = (value: unknown): string => (typeof value === "string" ? value : "")

export const toSkillDraft = (skill?: Record<string, unknown> | null): SkillDraft => ({
    name: text(skill?.name),
    description: text(skill?.description),
    body: text(skill?.body),
    files: Array.isArray(skill?.files) ? (skill.files as SkillFile[]) : [],
    allowExecutable: Boolean(skill?.allow_executable_files),
    ...(skill?.disable_model_invocation != null
        ? {disableModelInvocation: Boolean(skill.disable_model_invocation)}
        : {}),
})

/** The stored name: the typed name when it is a valid slug, else its slug. */
export const draftSkillName = (draft: Pick<SkillDraft, "name">): string =>
    SKILL_NAME_PATTERN.test(draft.name) ? draft.name : slugifySkillName(draft.name)

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

export const descriptionTooLong = (draft: Pick<SkillDraft, "description">): boolean =>
    draft.description.length > SKILL_DESCRIPTION_MAX

/** Nothing typed or added yet: leaving loses nothing. */
export const isSkillDraftEmpty = (draft: SkillDraft): boolean =>
    !draft.name.trim() && !draft.description.trim() && !draft.body.trim() && !draft.files.length

export const sameSkillDraft = (a: SkillDraft, b: SkillDraft): boolean =>
    JSON.stringify(toSkillContent(a)) === JSON.stringify(toSkillContent(b))

/** A folder of a file path ("" at the top), and its base name. */
export const dirOf = (path: string) =>
    path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
export const baseOf = (path: string) => path.split("/").pop() ?? path
export const isMarkdownPath = (path: string) => /\.(md|markdown|mdx)$/i.test(path)

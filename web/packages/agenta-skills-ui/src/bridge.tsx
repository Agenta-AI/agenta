/** The drill-in `skills` bridge implementation each host feeds its DrillInUIProvider. */
import {useMemo} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {buildSkillEmbedEntry, createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {invalidateSkillsListCache, skillsListDataAtom} from "@agenta/skills/state"
import type {SkillsBridge} from "@agenta/ui/drill-in"
import {getDefaultStore, useAtomValue} from "jotai"

import {SkillDetailHost} from "./SkillDetailHost"
import {SkillPickerHost} from "./SkillPickerHost"

/** Registry head versions by workflow slug — feeds the config rows' "vN available" nudge. */
function useHeadVersions(): Record<string, string> {
    const skills = useAtomValue(skillsListDataAtom)
    return useMemo(() => {
        const heads: Record<string, string> = {}
        for (const item of skills) {
            if (item.workflow_slug && item.version) {
                heads[item.workflow_slug] = item.version.replace(/^v/, "")
            }
        }
        return heads
    }, [skills])
}

/** Inline package -> registry skill + the embed entry that replaces it in place. */
async function publishInlineSkill(
    skill: Record<string, unknown>,
): Promise<{entry: Record<string, unknown>} | {error: string}> {
    const parsed = skillContentSchema.safeParse(skill)
    if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue?.path.join(".")
        return {error: `Fix the skill before publishing${path ? ` (${path})` : ""}.`}
    }
    const projectId = getDefaultStore().get(projectIdAtom) ?? ""
    if (!projectId) return {error: "No project in scope."}
    try {
        const created = await createSkillWorkflow({projectId, skill: parsed.data})
        invalidateSkillsListCache()
        return {
            entry: buildSkillEmbedEntry({
                slug: created.slug,
                workflowId: created.workflowId,
                name: parsed.data.name,
                description: parsed.data.description,
                mode: "latest",
            }) as unknown as Record<string, unknown>,
        }
    } catch (err) {
        return {
            error:
                err instanceof Error && err.message
                    ? `Publish failed: ${err.message}`
                    : "Publish failed.",
        }
    }
}

export function useSkillsBridge(): SkillsBridge {
    return useMemo(
        () => ({
            enabled: true,
            PickerHost: SkillPickerHost,
            DetailHost: SkillDetailHost,
            useHeadVersions,
            publishInlineSkill,
        }),
        [],
    )
}

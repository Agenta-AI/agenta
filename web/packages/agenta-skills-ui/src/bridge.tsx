/** The drill-in `skills` bridge implementation each host feeds its DrillInUIProvider. */
import {useMemo} from "react"

import type {SkillsBridge} from "@agenta/editor/drill-in"
import {createT} from "@agenta/i18n"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {projectIdAtom} from "@agenta/shared/state"
import {buildSkillEmbedEntry, createSkillWorkflow, skillContentSchema} from "@agenta/skills"
import {
    invalidateSkillsListCache,
    skillsListDataAtom,
    skillsResolveDataAtom,
} from "@agenta/skills/state"
import {getDefaultStore, useAtomValue} from "jotai"

import {AddSkillsBody} from "./AddSkillsBody"
import {AgentSkillCreateBody} from "./AgentSkillCreateBody"
import {RegistrySkillBody} from "./registrySkillView"

const tNow = createT(skillsGalleryCatalog)

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

/** Workflow slugs of archived registry skills — the config rows mark them as archived. */
function useArchivedSlugs(): ReadonlySet<string> {
    const registry = useAtomValue(skillsResolveDataAtom)
    return useMemo(
        () =>
            new Set(
                registry
                    .filter((entry) => entry.archived && entry.workflow_slug)
                    .map((entry) => entry.workflow_slug as string),
            ),
        [registry],
    )
}

/** Inline package -> registry skill + the embed entry that replaces it in place. */
async function publishInlineSkill(
    skill: Record<string, unknown>,
): Promise<{entry: Record<string, unknown>} | {error: string}> {
    const parsed = skillContentSchema.safeParse(skill)
    if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const path = issue?.path.join(".")
        return {
            error: path
                ? tNow("skills.gallery.publishFixSkillPath", {path})
                : tNow("skills.gallery.publishFixSkill"),
        }
    }
    const projectId = getDefaultStore().get(projectIdAtom) ?? ""
    if (!projectId) return {error: tNow("skills.gallery.noProject")}
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
                    ? tNow("skills.gallery.publishFailedDetail", {error: err.message})
                    : tNow("skills.gallery.publishFailed"),
        }
    }
}

export function useSkillsBridge(): SkillsBridge {
    return useMemo(
        () => ({
            enabled: true,
            AddSkillsBody,
            NewSkillBody: AgentSkillCreateBody,
            RegistrySkillBody,
            useHeadVersions,
            useArchivedSlugs,
            publishInlineSkill,
        }),
        [],
    )
}

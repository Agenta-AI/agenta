import {useCallback, useEffect, useMemo} from "react"

import {useDrillInUI} from "@agenta/editor/drill-in"
import {useT} from "@agenta/i18n"
import skillsAgentCatalog from "@agenta/i18n/catalogs/skills.agent"
import {useViewTitle, type ViewProps, type ViewTarget} from "@agenta/ui/view-stack"

import {isEmbedRefSkill, staticEmbedSlug} from "../itemDescriptors"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {skillAddNewView, type SkillAddViewParams} from "./skillAddView"

type Skill = Record<string, unknown>

const skillsOf = (agent: Skill): unknown[] => (Array.isArray(agent.skills) ? agent.skills : [])

const embedSlugOf = (entry: unknown): string | undefined =>
    isEmbedRefSkill(entry) ? staticEmbedSlug(entry as Skill) : undefined

/** The open "Add skills" view of each revision adds the skills its "New skill" makes. */
const intake = new Map<string, (entries: Skill[]) => void>()

const intakeKey = (target: ViewTarget) => (target.kind === "agent_draft" ? target.revisionId : "")

/** The registry list of the skills bridge; each add and remove writes the agent at once. */
const SkillAddViewBody = ({target, nav}: ViewProps<SkillAddViewParams>) => {
    const t = useT(skillsAgentCatalog)
    useViewTitle(t("skills.agent.addTitle"))
    const {skills: bridge} = useDrillInUI()
    const {agent, update} = useAgentConfigWriter(intakeKey(target))

    const addedSlugs = useMemo(
        () => skillsOf(agent).flatMap((entry) => embedSlugOf(entry) ?? []),
        [agent],
    )

    // Each write reads the agent at write time, so two quick clicks both land.
    const onAdd = useCallback(
        (entry: Skill) => {
            const slug = embedSlugOf(entry)
            if (!slug) return
            update((current) =>
                skillsOf(current).some((s) => embedSlugOf(s) === slug)
                    ? current
                    : {...current, skills: [...skillsOf(current), entry]},
            )
        },
        [update],
    )
    const onRemove = useCallback(
        (slug: string) =>
            update((current) => ({
                ...current,
                skills: skillsOf(current).filter((s) => embedSlugOf(s) !== slug),
            })),
        [update],
    )

    const key = intakeKey(target)
    useEffect(() => {
        const take = (entries: Skill[]) => entries.forEach(onAdd)
        intake.set(key, take)
        return () => {
            if (intake.get(key) === take) intake.delete(key)
        }
    }, [key, onAdd])

    const {push} = nav
    const onNewSkill = useCallback(() => void push?.(skillAddNewView, {}, target), [push, target])
    const Body = bridge?.AddSkillsBody
    if (!Body) return null
    return (
        <Body addedSlugs={addedSlugs} onAdd={onAdd} onRemove={onRemove} onNewSkill={onNewSkill} />
    )
}

/** "New skill" opened from "Add skills": each made skill is added to the agent below it. */
export const StagedSkillNewViewBody = ({target, nav}: ViewProps<SkillAddViewParams>) => {
    const {skills: bridge} = useDrillInUI()
    const key = intakeKey(target)
    const onCreated = useCallback((entries: Skill[]) => intake.get(key)?.(entries), [key])
    const Body = bridge?.NewSkillBody
    return Body ? <Body onCreated={onCreated} onDone={nav.cancel} /> : null
}

export default SkillAddViewBody

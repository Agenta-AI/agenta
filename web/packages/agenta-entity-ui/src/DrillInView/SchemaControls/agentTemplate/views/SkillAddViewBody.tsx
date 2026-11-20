import {useCallback, useMemo} from "react"

import {useT} from "@agenta/i18n"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {isEmbedRefSkill, staticEmbedSlug} from "../itemDescriptors"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {SkillAddViewParams} from "./skillAddView"
import {skillNewView} from "./skillNewView"

type Skill = Record<string, unknown>

const skillsOf = (agent: Skill): unknown[] => (Array.isArray(agent.skills) ? agent.skills : [])

const embedSlugOf = (entry: unknown): string | undefined =>
    isEmbedRefSkill(entry) ? staticEmbedSlug(entry as Skill) : undefined

/** The registry list of the skills bridge, writing each click into the agent configuration. */
const SkillAddViewBody = ({target, nav}: ViewProps<SkillAddViewParams>) => {
    const t = useT(skillsGalleryCatalog)
    useViewTitle(t("skills.gallery.addSkills"))
    const {skills: bridge} = useDrillInUI()
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const skills = skillsOf(writer.agent)
    const addedSlugs = useMemo(
        () => skills.map(embedSlugOf).filter((slug): slug is string => Boolean(slug)),
        [skills],
    )
    const {update} = writer
    const onAdd = useCallback(
        (entry: Skill) => {
            const slug = embedSlugOf(entry)
            update((agent) => {
                const current = skillsOf(agent)
                if (slug && current.some((s) => embedSlugOf(s) === slug)) return agent
                return {...agent, skills: [...current, entry]}
            })
        },
        [update],
    )
    const onRemove = useCallback(
        (slug: string) =>
            update((agent) => ({
                ...agent,
                skills: skillsOf(agent).filter((s) => embedSlugOf(s) !== slug),
            })),
        [update],
    )
    const {push} = nav
    const onNewSkill = useCallback(() => void push?.(skillNewView, {}, target), [push, target])
    const Body = bridge?.AddSkillsBody
    if (!Body) return null
    return (
        <Body addedSlugs={addedSlugs} onAdd={onAdd} onRemove={onRemove} onNewSkill={onNewSkill} />
    )
}

export default SkillAddViewBody

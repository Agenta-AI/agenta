import {useCallback, useMemo} from "react"

import {timeAgo} from "@agenta/shared/utils"
import {type SkillRegistryItem} from "@agenta/skills"
import {
    builtinSkillsAtom,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
} from "@agenta/skills/state"
import {SkillsGalleryPage, type SkillGallerySection, type SkillListItem} from "@agenta/skills-ui"
import {useAtom, useAtomValue} from "jotai"

const toUnixMs = (value?: string | null): number | undefined => {
    if (!value) return undefined
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : undefined
}

const toListItem = (item: SkillRegistryItem, origin: SkillListItem["origin"]): SkillListItem => ({
    id: item.workflow_id ?? item.id ?? item.workflow_slug ?? "",
    slug: item.workflow_slug ?? item.skill_name ?? "",
    name: item.name ?? item.workflow_slug ?? "",
    description: item.description ?? item.skill_description ?? undefined,
    origin,
    version: item.version ?? undefined,
    filesCount: item.files_count ?? undefined,
    age: timeAgo(toUnixMs(item.updated_at ?? item.created_at)) || undefined,
})

/**
 * The skill registry page: `@agenta/skills` atoms feeding the presentational
 * `SkillsGalleryPage`. Card/drawer navigation and the create flows wire up in the
 * follow-up checkpoints (W3.3 drawer rework, W5 upload/import).
 */
export default function SkillsPage() {
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const builtinSkills = useAtomValue(builtinSkillsAtom)
    const [search, setSearch] = useAtom(skillsSearchAtom)

    const sections = useMemo<SkillGallerySection[]>(() => {
        const project = projectSkills.map((item) => toListItem(item, "project"))
        const builtin = builtinSkills.map((item) => toListItem(item, "builtin"))
        return [
            {key: "project", label: "This project", skills: project},
            {key: "agenta", label: "Agenta", skills: builtin},
        ]
    }, [projectSkills, builtinSkills])

    const sources = useMemo(
        () => [
            {
                key: "all",
                label: "All skills",
                count: projectSkills.length + builtinSkills.length,
            },
            {key: "project", label: "This project", count: projectSkills.length},
            {key: "agenta", label: "Agenta", count: builtinSkills.length},
        ],
        [projectSkills.length, builtinSkills.length],
    )

    // Drawer + create flows land with the follow-up checkpoints; see plan-web.md W3.3/W5.
    const noop = useCallback(() => undefined, [])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SkillsGalleryPage
                sources={sources}
                selectedSource="all"
                onSelectSource={noop}
                search={search}
                onSearchChange={setSearch}
                sections={sections}
                onOpenSkill={noop}
                createActions={{onWrite: noop, onUpload: noop, onImport: noop}}
                loading={query.isPending}
            />
        </div>
    )
}

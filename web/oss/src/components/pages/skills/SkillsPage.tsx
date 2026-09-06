import {useCallback, useMemo, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {timeAgo} from "@agenta/shared/utils"
import {type SkillRegistryItem} from "@agenta/skills"
import {
    builtinSkillsAtom,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
} from "@agenta/skills/state"
import {
    SkillCreateDrawer,
    SkillImportDrawer,
    SkillsGalleryPage,
    type SkillGallerySection,
    type SkillListItem,
} from "@agenta/skills-ui"
import {useAtom, useAtomValue} from "jotai"

const toUnixMs = (value?: string | null): number | undefined => {
    if (!value) return undefined
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : undefined
}

const toListItem = (item: SkillRegistryItem, origin: SkillListItem["origin"]): SkillListItem => ({
    id: item.workflow_id ?? item.id ?? item.workflow_slug ?? "",
    // Registry identity is the SKILL name; workflow_slug is the storage slug (__ag__… for builtins).
    slug: item.skill_name ?? item.name ?? item.workflow_slug ?? "",
    name: item.name ?? item.skill_name ?? item.workflow_slug ?? "",
    description: item.description ?? item.skill_description ?? undefined,
    origin,
    // API sends "v1"; VersionTag adds the "v" prefix itself.
    version: item.version?.replace(/^v/, "") ?? undefined,
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

    // Card drawer + write/upload land with the follow-up checkpoints; see plan-web.md W3.3/W5.
    const noop = useCallback(() => undefined, [])
    const projectId = useAtomValue(projectIdAtom)
    const [importOpen, setImportOpen] = useState(false)
    const openImport = useCallback(() => setImportOpen(true), [])
    const closeImport = useCallback(() => setImportOpen(false), [])
    // Write and Upload share the create drawer; the MODE decides its opening state —
    // Upload starts as the full-drawer dropzone and morphs into the editor (1c → 1d).
    const [createMode, setCreateMode] = useState<"write" | "upload" | null>(null)
    const openWrite = useCallback(() => setCreateMode("write"), [])
    const openUpload = useCallback(() => setCreateMode("upload"), [])
    const closeCreate = useCallback(() => setCreateMode(null), [])
    const createActions = useMemo(
        () => ({onWrite: openWrite, onUpload: openUpload, onImport: openImport}),
        [openWrite, openUpload, openImport],
    )

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
                createActions={createActions}
                loading={query.isPending}
            />
            <SkillImportDrawer
                open={importOpen}
                onClose={closeImport}
                projectId={projectId ?? ""}
            />
            <SkillCreateDrawer
                open={createMode !== null}
                onClose={closeCreate}
                projectId={projectId ?? ""}
                mode={createMode ?? "write"}
            />
        </div>
    )
}

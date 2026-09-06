import {useCallback, useMemo, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {
    builtinSkillsAtom,
    registrySourcesAtom,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
    skillsShowArchivedAtom,
} from "@agenta/skills/state"
import {
    buildRegistrySections,
    SkillCreateDrawer,
    SkillDetailDrawer,
    SkillImportDrawer,
    SkillsGalleryPage,
    type SkillListItem,
} from "@agenta/skills-ui"
import {useAtom, useAtomValue} from "jotai"

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
    const [showArchived, setShowArchived] = useAtom(skillsShowArchivedAtom)

    const registrySources = useAtomValue(registrySourcesAtom)
    const [selectedSource, setSelectedSource] = useState("all")
    const {sections, sources} = useMemo(
        () => buildRegistrySections(projectSkills, builtinSkills, registrySources, selectedSource),
        [projectSkills, builtinSkills, registrySources, selectedSource],
    )

    const projectId = useAtomValue(projectIdAtom)
    // Card click -> the detail drawer (read-only editor + versions rail + used-by).
    const [detailSkill, setDetailSkill] = useState<SkillListItem | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const openSkill = useCallback((item: SkillListItem) => {
        setDetailSkill(item)
        setDetailOpen(true)
    }, [])
    // Keep the item through the exit animation; only the open flag flips.
    const closeDetail = useCallback(() => setDetailOpen(false), [])
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
                selectedSource={selectedSource}
                onSelectSource={setSelectedSource}
                search={search}
                onSearchChange={setSearch}
                sections={sections}
                onOpenSkill={openSkill}
                createActions={createActions}
                loading={query.isPending}
                showArchived={showArchived}
                onShowArchivedChange={setShowArchived}
            />
            <SkillDetailDrawer
                open={detailOpen}
                onClose={closeDetail}
                projectId={projectId ?? ""}
                skill={detailSkill}
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

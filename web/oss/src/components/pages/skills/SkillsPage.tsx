import {useCallback, useMemo, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {
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
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import clsx from "clsx"
import {useAtom, useAtomValue} from "jotai"

import {BROWSE_RAIL_MODE} from "../agent-home/assets/constants"

// The skill registry page: @agenta/skills atoms feeding the presentational SkillsGalleryPage.
// `BROWSE_RAIL_MODE` picks the shell, the same way agents and templates do.
export default function SkillsPage() {
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const [search, setSearch] = useAtom(skillsSearchAtom)
    const [showArchived, setShowArchived] = useAtom(skillsShowArchivedAtom)

    const [selectedSource, setSelectedSource] = useState("all")
    const {sections, sources} = useMemo(
        () => buildRegistrySections(projectSkills, selectedSource),
        [projectSkills, selectedSource],
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

    const gallery = (
        <SkillsGalleryPage
            layout={BROWSE_RAIL_MODE ? "rail" : "toolbar"}
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
    )

    return (
        <>
            {BROWSE_RAIL_MODE ? (
                <PageLayout className="grow min-h-0 !p-0">{gallery}</PageLayout>
            ) : (
                // The page's own title and gutters, so the grid shares one column width with the
                // rest of the app; create, search and the archived toggle are a toolbar above it.
                <PageLayout className={clsx(pageContentWidthClass, "grow min-h-0")} title="Skills">
                    {gallery}
                </PageLayout>
            )}
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
        </>
    )
}

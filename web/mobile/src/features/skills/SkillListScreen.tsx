import {useCallback, useMemo, useState} from "react"

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
    NewSkillMenuButton,
    SkillCreateDrawer,
    SkillDetailDrawer,
    SkillGallerySections,
    SkillImportDrawer,
    type SkillListItem,
} from "@agenta/skills-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {Checkbox, SearchInput} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {BROWSE_RAIL_MODE} from "@/lib/browseLayout"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

/**
 * The skill registry — where the nav's Skills entry lands. Same browse shape as agents and
 * sessions: title and search in a pinned toolbar (or the rail, in rail mode), the shared
 * `SkillGallerySections` grid below — the same cards the desktop registry page renders.
 * Card/drawer navigation and the create flows land with the desktop's follow-up
 * checkpoints (plan-web.md W3.3/W5).
 */
export const SkillListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const builtinSkills = useAtomValue(builtinSkillsAtom)
    const [search, setSearch] = useAtom(skillsSearchAtom)
    const [showArchived, setShowArchived] = useAtom(skillsShowArchivedAtom)

    const registrySources = useAtomValue(registrySourcesAtom)
    const {sections} = useMemo(
        () => buildRegistrySections(projectSkills, builtinSkills, registrySources),
        [projectSkills, builtinSkills, registrySources],
    )

    // Card tap -> the detail drawer (read-only editor + versions rail + used-by).
    const [detailSkill, setDetailSkill] = useState<SkillListItem | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const openSkill = useCallback((item: SkillListItem) => {
        setDetailSkill(item)
        setDetailOpen(true)
    }, [])
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

    // Identical content in both shells — a toolbar above the results, or the rail beside them.
    const browseControls = (
        <div
            className={
                BROWSE_RAIL_MODE
                    ? "contents"
                    : `${pageContentWidthClass} flex shrink-0 flex-col gap-3 px-6 pb-3 pt-2 lg:px-16 lg:pt-14`
            }
        >
            <div className="flex min-w-0 items-center gap-2">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                <h1 className="text-colorText m-0 min-w-0 flex-1 truncate text-[24px] font-semibold leading-[1.3333333333333333]">
                    Skills
                </h1>
                <NewSkillMenuButton
                    onWrite={openWrite}
                    onUpload={openUpload}
                    onImport={openImport}
                />
            </div>

            <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search skills by name…"
            />
            <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                    checked={showArchived}
                    onCheckedChange={(next) => setShowArchived(next === true)}
                    aria-label="Show archived skills"
                />
                Show archived
            </label>
        </div>
    )

    const gallery = (
        <div className="flex flex-col gap-6">
            <SkillGallerySections
                sections={sections}
                onOpenSkill={openSkill}
                search={search}
                loading={query.isPending}
            />
        </div>
    )

    return (
        <>
            <PageTitle title="Skills" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold fill header={BROWSE_RAIL_MODE ? undefined : browseControls}>
                    {BROWSE_RAIL_MODE ? (
                        <FilterRailLayout
                            rail={browseControls}
                            contentClassName="overflow-y-auto px-6 pb-6 pt-4"
                        >
                            {gallery}
                        </FilterRailLayout>
                    ) : (
                        <div
                            className={`${pageContentWidthClass} min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 lg:px-16`}
                        >
                            {gallery}
                        </div>
                    )}
                </ScreenScaffold>
            </AppShell>
            <SkillDetailDrawer
                open={detailOpen}
                onClose={closeDetail}
                projectId={projectId}
                skill={detailSkill}
            />
            <SkillImportDrawer open={importOpen} onClose={closeImport} projectId={projectId} />
            <SkillCreateDrawer
                open={createMode !== null}
                onClose={closeCreate}
                projectId={projectId}
                mode={createMode ?? "write"}
            />
        </>
    )
}

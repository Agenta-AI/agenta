import {useCallback, useMemo} from "react"

import {timeAgo} from "@agenta/shared/utils"
import {type SkillRegistryItem} from "@agenta/skills"
import {
    builtinSkillsAtom,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
} from "@agenta/skills/state"
import {SkillGallerySections, type SkillGallerySection, type SkillListItem} from "@agenta/skills-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {FilterRailLayout} from "@agenta/ui/components/presentational"
import {SearchInput} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {BROWSE_RAIL_MODE} from "@/lib/browseLayout"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

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

    const sections = useMemo<SkillGallerySection[]>(
        () => [
            {
                key: "project",
                label: "This project",
                skills: projectSkills.map((item) => toListItem(item, "project")),
            },
            {
                key: "agenta",
                label: "Agenta",
                skills: builtinSkills.map((item) => toListItem(item, "builtin")),
            },
        ],
        [projectSkills, builtinSkills],
    )

    const noop = useCallback(() => undefined, [])

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
            </div>

            <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search skills by name…"
            />
        </div>
    )

    const gallery = (
        <div className="flex flex-col gap-6">
            <SkillGallerySections
                sections={sections}
                onOpenSkill={noop}
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
        </>
    )
}

import {useCallback, useState} from "react"

import {SkillDetailView} from "@agenta/skills-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {agentEntryHref} from "../agents/agentEntry"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {SkillBackLink} from "./SkillBackLink"
import {useSkillLeaveGuard} from "./useSkillLeaveGuard"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** One skill on its own page: edit, save, archive, check upstream. */
export const SkillPageScreen = ({
    workspaceId,
    projectId,
    skillId,
}: {
    workspaceId: string
    projectId: string
    skillId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const listHref = `${base}/skills`
    const [dirty, setDirty] = useState(false)
    const {leave, modal} = useSkillLeaveGuard(dirty)
    const agentHref = useCallback((agentId: string) => agentEntryHref(base, agentId), [base])

    return (
        <>
            <PageTitle title="Skill" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className={`box-border flex shrink-0 items-center gap-2 px-4 pt-3 lg:hidden ${PAGE_FRAME}`}>
                            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 lg:pt-8 ${PAGE_FRAME}`}>
                        <SkillDetailView
                            key={skillId}
                            projectId={projectId}
                            workflowId={skillId}
                            agentHref={agentHref}
                            onDirtyChange={setDirty}
                            onArchived={() => leave(listHref)}
                            top={<SkillBackLink href={listHref} label="Skills" />}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            {modal}
        </>
    )
}

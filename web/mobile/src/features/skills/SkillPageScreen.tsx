import {useCallback, useState} from "react"

import {SkillDetailView} from "@agenta/skills-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {agentEntryHref} from "../agents/agentEntry"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {SkillBackLink} from "./SkillBackLink"
import {SkillScreenBar} from "./SkillScreenBar"
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
    const [bar, setBar] = useState<HTMLDivElement | null>(null)

    return (
        <>
            <PageTitle title="Skill" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <SkillScreenBar
                            workspaceId={workspaceId}
                            projectId={projectId}
                            back={<SkillBackLink href={listHref} label="Skills" />}
                            onSlot={setBar}
                            className={PAGE_FRAME}
                        />
                    }
                >
                    <div
                        className={`flex min-w-0 flex-1 flex-col px-4 pb-12 pt-1 lg:min-h-0 lg:pb-8 lg:pt-8 ${PAGE_FRAME}`}
                    >
                        <SkillDetailView
                            key={skillId}
                            projectId={projectId}
                            workflowId={skillId}
                            agentHref={agentHref}
                            onDirtyChange={setDirty}
                            onArchived={() => leave(listHref)}
                            top={
                                <span className="flex max-lg:hidden">
                                    <SkillBackLink href={listHref} label="Skills" />
                                </span>
                            }
                            actionsTarget={bar}
                        />
                    </div>
                </ScreenScaffold>
            </AppShell>
            {modal}
        </>
    )
}

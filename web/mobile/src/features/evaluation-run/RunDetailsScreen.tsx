import {runHeaderAtomFamily} from "@agenta/entities/evaluationRun"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useDeveloperPageFrame, useDetailHeaderTop} from "../developer/developerPageFrame"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {RunDetailsBody} from "./RunDetailsBody"
import {RunDetailsHeader} from "./RunDetailsHeader"

/**
 * One evaluation run: its title, a Stop or Resume action for a live run, and its tabs. Opening
 * the page only reads the run; nothing is written.
 */
export const RunDetailsScreen = ({
    workspaceId,
    projectId,
    runId,
}: {
    workspaceId: string
    projectId: string
    runId: string
}) => {
    const PAGE_FRAME = useDeveloperPageFrame()
    const headerTop = useDetailHeaderTop()
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const header = useAtomValue(runHeaderAtomFamily(runId))

    return (
        <>
            <PageTitle title={header?.name ?? "Evaluation"} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 ${headerTop} ${PAGE_FRAME}`}
                        >
                            <RunDetailsHeader
                                projectId={projectId}
                                runId={runId}
                                nav={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
                            />
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <RunDetailsBody projectId={projectId} runId={runId} />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}

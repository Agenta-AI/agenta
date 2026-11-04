import {runHeaderAtomFamily} from "@agenta/entities/evaluationRun"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {RunDetailsBody} from "./RunDetailsBody"
import {RunDetailsHeader} from "./RunDetailsHeader"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * One evaluation run: its title, a Pause or Resume action for a live run, and its tabs. Opening
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
    useBindProjectContext(projectId)
    const header = useAtomValue(runHeaderAtomFamily(runId))

    return (
        <>
            <PageTitle title={header?.name ?? "Evaluation"} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
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
                        <RunDetailsBody runId={runId} />
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}

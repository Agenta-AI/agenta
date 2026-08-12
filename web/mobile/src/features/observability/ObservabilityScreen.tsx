import {useState} from "react"

import {ObservabilityRangePicker} from "@agenta/observability-ui"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"

import {useBindProjectContext} from "@/features/context/useBindProjectContext"

import {SessionsList} from "./SessionsList"
import {TracesList} from "./TracesList"

type ObservabilityTab = "traces" | "sessions"

/**
 * Project-wide observability on mobile.
 *
 * The range control is the SAME component desktop renders, not a mobile sheet. Building a
 * parallel sort sheet was the original plan; the chrome conversion landed the shared control
 * first precisely so this screen would not need one.
 */
export const ObservabilityScreen = ({projectId}: {projectId: string}) => {
    useBindProjectContext(projectId)

    const [tab, setTab] = useState<ObservabilityTab>("traces")

    // No scope binding: the seam's own defaults are project-wide with no workflow, which is
    // exactly this screen. Binding would only re-state them.

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
                <Tabs value={tab} onValueChange={(next) => setTab(next as ObservabilityTab)}>
                    <TabsList>
                        <TabsTrigger value="traces">Traces</TabsTrigger>
                        <TabsTrigger value="sessions">Sessions</TabsTrigger>
                    </TabsList>
                </Tabs>
                <ObservabilityRangePicker />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {tab === "traces" ? <TracesList /> : <SessionsList />}
            </div>
        </div>
    )
}

export default ObservabilityScreen

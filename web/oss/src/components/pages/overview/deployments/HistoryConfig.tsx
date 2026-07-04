import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {useAtomValue} from "jotai"

import OSSdrillInUIProvider from "@/oss/components/DrillInView/OSSdrillInUIProvider"

interface HistoryConfigProps {
    /** The workflow/app revision ID to display configuration for */
    revisionId: string
    /** If true, show the server (original) config in read-only mode */
    showOriginal?: boolean
}

const HistoryConfig = ({revisionId, showOriginal}: HistoryConfigProps) => {
    const config = useAtomValue(
        useMemo(() => workflowMolecule.selectors.configuration(revisionId), [revisionId]),
    )

    const hasParams = config && Object.keys(config).length > 0

    return (
        <div className="flex flex-col gap-4 grow h-full">
            <span className="text-base font-medium">Configuration</span>

            {hasParams ? (
                <OSSdrillInUIProvider>
                    <PlaygroundConfigSection
                        revisionId={revisionId}
                        disabled={!!showOriginal}
                        useServerData={!!showOriginal}
                    />
                </OSSdrillInUIProvider>
            ) : (
                <span className="font-medium text-center mt-12 text-muted-foreground">
                    No Parameters
                </span>
            )}
        </div>
    )
}

export default HistoryConfig

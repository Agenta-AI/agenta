import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {NewVariantParametersView} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/assets/Parameters"

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
            <Typography.Text className="text-base font-medium">Configuration</Typography.Text>

            {hasParams ? (
                <div className="flex flex-col gap-6 grow">
                    <div className="flex flex-col gap-2 grow">
                        <NewVariantParametersView
                            revisionId={revisionId}
                            showOriginal={showOriginal}
                        />
                    </div>
                </div>
            ) : (
                <Typography.Text type="secondary" className="font-medium text-center mt-12">
                    No Parameters
                </Typography.Text>
            )}
        </div>
    )
}

export default HistoryConfig

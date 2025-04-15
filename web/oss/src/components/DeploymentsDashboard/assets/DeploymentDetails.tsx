import {DeploymentRevisionConfig} from "@/oss/lib/Types"
import {Tabs} from "antd"
import React from "react"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import HistoryConfig from "../../pages/overview/deployments/HistoryConfig"

interface DeploymentDetailsProps {
    revisionConfig: DeploymentRevisionConfig | null
    variant: EnhancedVariant | undefined
}

const DeploymentDetails = ({revisionConfig, variant}: DeploymentDetailsProps) => {
    return (
        <Tabs
            destroyInactiveTabPane
            defaultActiveKey={"variant"}
            items={[
                {
                    key: "variant",
                    label: "Variant",
                    children:
                        revisionConfig && variant ? (
                            <div className="h-full">
                                <HistoryConfig
                                    depRevisionConfig={revisionConfig}
                                    variant={variant as any}
                                />
                            </div>
                        ) : null,
                },
            ]}
        />
    )
}

export default DeploymentDetails

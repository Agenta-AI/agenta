import {memo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Space} from "antd"

interface ScenarioLoadingIndicatorProps {
    message?: string
}

const ScenarioLoadingIndicator = ({message}: ScenarioLoadingIndicatorProps) => (
    <Space align="center" className="justify-center w-full py-8">
        <Button disabled variant="ghost">
            <Spinner />
        </Button>
        <span className="text-muted-foreground">{message ?? "Loading scenario..."}</span>
    </Space>
)

export default memo(ScenarioLoadingIndicator)

import {memo} from "react"

import {LinkSimple} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

const ConfigureProviderDrawerTitle = () => {
    return (
        <div className="flex items-center justify-between">
            <Typography.Text className="text-sm font-medium">Configure provider</Typography.Text>
            <Button
                type="link"
                icon={<LinkSimple size={14} className="mt-1" />}
                href="https://agenta.ai/docs/prompt-engineering/playground/adding-custom-providers"
                target="_blank"
                rel="noreferrer"
            >
                How to use
            </Button>
        </div>
    )
}

export default memo(ConfigureProviderDrawerTitle)

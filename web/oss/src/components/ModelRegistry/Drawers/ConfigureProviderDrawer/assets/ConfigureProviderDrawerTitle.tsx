import {memo} from "react"

import {LinkSimple} from "@phosphor-icons/react"
import {Button} from "antd"

const ConfigureProviderDrawerTitle = () => {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Configure provider</span>
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

import {memo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {LinkSimple} from "@phosphor-icons/react"

const ConfigureProviderDrawerTitle = () => {
    return (
        <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Configure provider</span>
            <Button
                variant="link"
                render={
                    <a
                        href="https://agenta.ai/docs/prompt-engineering/playground/adding-custom-providers"
                        target="_blank"
                        rel="noreferrer"
                    />
                }
            >
                {<LinkSimple size={14} className="mt-1" />}
                How to use
            </Button>
        </div>
    )
}

export default memo(ConfigureProviderDrawerTitle)

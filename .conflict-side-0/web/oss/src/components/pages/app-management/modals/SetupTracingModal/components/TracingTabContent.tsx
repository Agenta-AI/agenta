import dynamic from "next/dynamic"

import {TracingCodeComponent} from "./TracingCodeComponent"

const ApiKeyInput: any = dynamic(
    () => import("@/oss/components/pages/app-management/components/ApiKeyInput"),
)

export const TracingTabContent = ({
    apiKeyValue,
    setApiKeyValue,
    codeBlock,
}: {
    apiKeyValue: string
    setApiKeyValue: (val: string) => void
    codeBlock: {title: string; code: string}[]
}) => (
    <div className="flex flex-col gap-6">
        <ApiKeyInput apiKeyValue={apiKeyValue} onApiKeyChange={setApiKeyValue} />
        {codeBlock.map((command, index) => (
            <TracingCodeComponent key={index} command={command} index={index} />
        ))}
    </div>
)

import {memo} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"

import LabelInput from "../../../assets/LabelInput"

import {ConfigureProviderModalContentProps} from "./types"

const ConfigureProviderModalContent = ({
    selectedProvider,
    ...props
}: ConfigureProviderModalContentProps) => {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-start gap-1">
                <span>Provider</span>
                <Badge className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]" variant="secondary">
                    {selectedProvider?.title}
                </Badge>
            </div>
            <div className="flex flex-col gap-1">
                <LabelInput
                    label="API Key"
                    placeholder="Enter API key"
                    type="password"
                    onFocus={(e) => e.target.select()}
                    {...props}
                />
                <span className="text-[var(--ag-c-586673)]">
                    This secret will be encrypted in transit and at rest.
                </span>
            </div>
        </div>
    )
}

export default memo(ConfigureProviderModalContent)

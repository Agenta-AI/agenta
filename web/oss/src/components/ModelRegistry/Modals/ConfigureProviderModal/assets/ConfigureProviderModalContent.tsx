import {memo} from "react"
import {Tag, Typography} from "antd"

import LabelInput from "../../../assets/LabelInput"

import {ConfigureProviderModalContentProps} from "./types"

const {Text} = Typography

const ConfigureProviderModalContent = ({
    selectedProvider,
    ...props
}: ConfigureProviderModalContentProps) => {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-start gap-1">
                <Text>Provider</Text>
                <Tag bordered={false} color="default" className="bg-[#0517290F] px-2 py-[1px]">
                    {selectedProvider?.title}
                </Tag>
            </div>
            <div className="flex flex-col gap-1">
                <LabelInput
                    label="API Key"
                    placeholder="Enter API key"
                    type="password"
                    onFocus={(e) => e.target.select()}
                    {...props}
                />
                <Text className="text-[#586673]">
                    This secret will be encrypted in transit and at rest.
                </Text>
            </div>
        </div>
    )
}

export default memo(ConfigureProviderModalContent)

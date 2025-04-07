import {Tag} from "antd"
import React from "react"

const statusMap: Record<string, {bgColor: string; textColor: string; label: string}> = {
    production: {bgColor: "bg-[#D9F7BE]", textColor: "text-[#237804]", label: "Production"},
    staging: {bgColor: "bg-[#FFF2E8]", textColor: "text-[#FA541C]", label: "Staging"},
    development: {bgColor: "bg-[#F9F0FF]", textColor: "text-[#722ED1]", label: "Development"},
}

const defaultStatus = {bgColor: "bg-gray-200", textColor: "text-gray-600", label: "Unknown"}

const EnvironmentTagLabel: React.FC<{environment: string}> = ({environment}) => {
    const {bgColor, textColor, label} = statusMap[environment] ?? defaultStatus

    return (
        <Tag className={`${bgColor} ${textColor} w-fit`} bordered={false}>
            {label}
        </Tag>
    )
}

export default EnvironmentTagLabel

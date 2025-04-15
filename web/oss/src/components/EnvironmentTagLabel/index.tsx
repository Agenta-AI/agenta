import {Tag} from "antd"
import React from "react"

export const deploymentStatusColors: Record<
    string,
    {bgColor: string; textColor: string; label: string}
> = {
    production: {bgColor: "#D9F7BE", textColor: "#237804", label: "Production"},
    staging: {bgColor: "#FFF2E8", textColor: "#FA541C", label: "Staging"},
    development: {bgColor: "#F9F0FF", textColor: "#722ED1", label: "Development"},
}

const defaultStatus = {bgColor: "bg-gray-200", textColor: "text-gray-600", label: "Unknown"}

const EnvironmentTagLabel: React.FC<{environment: string}> = ({environment}) => {
    const {bgColor, textColor, label} = deploymentStatusColors[environment] ?? defaultStatus

    return (
        <Tag
            style={{backgroundColor: bgColor, color: textColor}}
            className="w-fit"
            bordered={false}
        >
            {label}
        </Tag>
    )
}

export default EnvironmentTagLabel

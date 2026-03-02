import {type FC} from "react"

import {Tag} from "antd"

export const deploymentStatusColors: Record<
    string,
    {bgColor: string; textColor: string; label: string}
> = {
    production: {bgColor: "#D9F7BE", textColor: "#237804", label: "Production"},
    staging: {bgColor: "#FFF2E8", textColor: "#FA541C", label: "Staging"},
    development: {bgColor: "#F9F0FF", textColor: "#722ED1", label: "Development"},
}

// const defaultColors = {bgColor: "bg-gray-200", textColor: "text-gray-600"}

const EnvironmentTagLabel: FC<{environment: string}> = ({environment}) => {
    const known = deploymentStatusColors[environment]
    const label = known?.label ?? (environment || "Unknown")

    return <Tag className="w-fit">{label}</Tag>
}

export default EnvironmentTagLabel

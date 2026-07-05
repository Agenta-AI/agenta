import {ReactNode} from "react"

import {CloseCircleFilled} from "@ant-design/icons"
import {Result, Spin} from "antd"

interface ResultComponentProps {
    status: ReactNode
    title: string
    subtitle?: string
    spinner?: boolean
}

const ResultComponent: React.FC<ResultComponentProps> = ({status, title, subtitle, spinner}) => {
    return (
        <Result
            icon={status === "error" && <CloseCircleFilled className="text-[#ff4d4f]" />}
            title={<h3 className="capitalize text-lg font-semibold leading-snug">{title}</h3>}
            subTitle={subtitle}
            extra={spinner && <Spin />}
        />
    )
}

export default ResultComponent

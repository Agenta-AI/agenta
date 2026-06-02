import {ReactNode} from "react"

import {CloseCircleFilled} from "@ant-design/icons"
import {Result, Spin, Typography} from "antd"

const {Title} = Typography

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
            title={
                <Title level={3} className="capitalize">
                    {title}
                </Title>
            }
            subTitle={subtitle}
            extra={spinner && <Spin />}
        />
    )
}

export default ResultComponent

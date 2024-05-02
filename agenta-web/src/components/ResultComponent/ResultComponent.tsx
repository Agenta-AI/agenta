import {CloseCircleFilled} from "@ant-design/icons"
import {Result, Spin, Typography} from "antd"
import React, {ReactNode} from "react"
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
            icon={status === "error" && <CloseCircleFilled style={{color: "#ff4d4f"}} />}
            title={
                <Title level={3} style={{textTransform: "capitalize"}}>
                    {title}
                </Title>
            }
            subTitle={subtitle}
            extra={spinner && <Spin size="large" />}
        />
    )
}

export default ResultComponent

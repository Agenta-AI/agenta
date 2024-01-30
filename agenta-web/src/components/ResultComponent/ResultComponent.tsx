import {Result, Spin} from "antd"
import {ResultStatusType} from "antd/es/result"
import React from "react"

interface ResultComponentProps {
    status: ResultStatusType
    title: string
    subtitle?: string
    spinner?: boolean
}

const ResultComponent: React.FC<ResultComponentProps> = ({status, title, subtitle, spinner}) => {
    return <Result status={status} title={title} subTitle={subtitle} extra={spinner && <Spin />} />
}

export default ResultComponent

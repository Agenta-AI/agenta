import {ReactNode} from "react"

import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {CloseCircleFilled} from "@ant-design/icons"
import {Result} from "antd"

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
            extra={spinner && <Spinner />}
        />
    )
}

export default ResultComponent

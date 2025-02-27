import {ReactNode} from "react"

import {CloseCircleFilled} from "@ant-design/icons"
import {Result, Spin, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"
const {Title} = Typography

interface ResultComponentProps {
    status: ReactNode
    title: string
    subtitle?: string
    spinner?: boolean
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    closeCircleIcon: {
        color: "#ff4d4f",
    },
    title: {
        textTransform: "capitalize",
    },
}))

const ResultComponent: React.FC<ResultComponentProps> = ({status, title, subtitle, spinner}) => {
    const classes = useStyles()

    return (
        <Result
            icon={status === "error" && <CloseCircleFilled className={classes.closeCircleIcon} />}
            title={
                <Title level={3} className={classes.title}>
                    {title}
                </Title>
            }
            subTitle={subtitle}
            extra={spinner && <Spin />}
        />
    )
}

export default ResultComponent

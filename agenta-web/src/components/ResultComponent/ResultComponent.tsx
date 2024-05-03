import {JSSTheme} from "@/lib/Types"
import {CloseCircleFilled} from "@ant-design/icons"
import {Result, Spin, Typography} from "antd"
import React, {ReactNode} from "react"
import {createUseStyles} from "react-jss"
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

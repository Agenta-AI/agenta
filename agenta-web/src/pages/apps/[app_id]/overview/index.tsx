import DeploymentOverview from "@/components/pages/overview/deployments/DeploymentOverview"
import {JSSTheme} from "@/lib/Types"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingLG,
    },
    section: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
}))

export default function Overview() {
    const classes = useStyles()
    return (
        <div className={classes.container}>
            <Title level={3}>Overview</Title>

            <div>Observability Cards</div>

            <DeploymentOverview />

            <div>hello</div>
            <div>hello</div>
        </div>
    )
}

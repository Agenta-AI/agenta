import AbTestingEvalOverview from "@/components/pages/overview/abTestingEvaluation/AbTestingEvalOverview"
import AutomaticEvalOverview from "@/components/pages/overview/automaticEvaluation/AutomaticEvalOverview"
import DeploymentOverview from "@/components/pages/overview/deployments/DeploymentOverview"
import ObservabilityOverview from "@/components/pages/overview/observability/ObservabilityOverview"
import SingleModelEvalOverview from "@/components/pages/overview/singleModelEvaluation/SingleModelEvalOverview"
import VariantsOverview from "@/components/pages/overview/variants/VariantsOverview"
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
}))

export default function Overview() {
    const classes = useStyles()
    return (
        <div className={classes.container}>
            <Title level={3}>Overview</Title>

            <ObservabilityOverview />

            <DeploymentOverview />

            <VariantsOverview />

            <AutomaticEvalOverview />

            <AbTestingEvalOverview />

            <SingleModelEvalOverview />
        </div>
    )
}

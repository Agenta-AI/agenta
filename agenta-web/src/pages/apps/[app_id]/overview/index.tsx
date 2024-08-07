import AbTestingEvalOverview from "@/components/pages/overview/abTestingEvaluation/AbTestingEvalOverview"
import AutomaticEvalOverview from "@/components/pages/overview/automaticEvaluation/AutomaticEvalOverview"
import DeploymentOverview from "@/components/pages/overview/deployments/DeploymentOverview"
import SingleModelEvalOverview from "@/components/pages/overview/singleModelEvaluation/SingleModelEvalOverview"
import VariantsOverview from "@/components/pages/overview/variants/VariantsOverview"
import {useAppsData} from "@/contexts/app.context"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {JSSTheme} from "@/lib/Types"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"

const ObservabilityOverview = dynamicComponent("pages/overview/observability/ObservabilityOverview")

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingLG,
        "& h1": {
            fontSize: theme.fontSizeHeading4,
            fontWeight: 500,
            lineHeight: theme.lineHeightHeading4,
        },
    },
}))

export default function Overview() {
    const classes = useStyles()
    const {currentApp} = useAppsData()
    const capitalizedAppName = renameVariablesCapitalizeAll(currentApp?.app_name || "")

    return (
        <div className={classes.container}>
            <Title>{capitalizedAppName}</Title>

            <ObservabilityOverview />

            <DeploymentOverview />

            <VariantsOverview />

            <AutomaticEvalOverview />

            <AbTestingEvalOverview />

            <SingleModelEvalOverview />
        </div>
    )
}

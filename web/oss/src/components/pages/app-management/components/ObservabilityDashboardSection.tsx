import {Typography} from "antd"
import {createUseStyles} from "react-jss"

import AnalyticsDashboard from "@/oss/components/pages/observability/dashboard/AnalyticsDashboard"
import {JSSTheme} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-spin-nested-loading": {
            width: "100%",
        },
    },
    sectionSubtitle: {
        fontSize: 13,
        color: theme.colorTextSecondary,
        fontWeight: 400,
    },
}))

const ObservabilityDashboardSection = () => {
    const classes = useStyles()

    return (
        <div className={`flex flex-col gap-4 ${classes.container}`}>
            <AnalyticsDashboard layout="grid-4" />
        </div>
    )
}

export default ObservabilityDashboardSection

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
        <div className={`my-6 flex flex-col gap-4 ${classes.container}`}>
            <div className="flex items-baseline justify-between">
                <Typography.Title level={2} className="!m-0">
                    Analytics
                </Typography.Title>
                <span className={classes.sectionSubtitle}>Last 30 days</span>
            </div>
            <AnalyticsDashboard layout="grid-4" />
        </div>
    )
}

export default ObservabilityDashboardSection

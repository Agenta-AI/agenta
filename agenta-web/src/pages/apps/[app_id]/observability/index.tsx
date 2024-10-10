import GenericDrawer from "@/components/GenericDrawer"
import TraceContent from "@/components/pages/observability/drawer/TraceContent"
import TraceHeader from "@/components/pages/observability/drawer/TraceHeader"
import TraceTree from "@/components/pages/observability/drawer/TraceTree"
import {useQueryParam} from "@/hooks/useQuery"
import {JSSTheme} from "@/lib/Types"
import {Button, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

interface Props {}

const ObservabilityDashboard: React.FC<Props> = () => {
    const classes = useStyles()
    const [selectedTraceId, setSelectedTraceId] = useQueryParam("trace", "")

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className={classes.title}>Observability</Typography.Text>

            <div>Observability Table</div>
            <Button onClick={() => setSelectedTraceId("12345")} className="w-fit">
                Open drawer
            </Button>

            <GenericDrawer
                open={!!selectedTraceId}
                onClose={() => setSelectedTraceId("")}
                expandable
                headerExtra={<TraceHeader />}
                mainContent={<TraceContent />}
                sideContent={<TraceTree />}
            />
        </div>
    )
}

export default ObservabilityDashboard

import {ReactNode, useState} from "react"

import {Tabs, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        borderRadius: theme.borderRadiusLG,
        border: `1px solid ${theme.colorBorder}`,
        display: "flex",
        flexDirection: "column",
        padding: theme.padding,
    },
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    subHeadingRoot: {
        display: "flex",
        gap: 8,
        marginBottom: theme.padding,
    },
}))

interface WidgetData {
    leftSubHeading?: ReactNode
    rightSubHeading?: ReactNode
    children?: ReactNode
    title: string
}

interface Props extends WidgetData {
    tabs?: WidgetData[]
}

const WidgetInnerContent: React.FC<Omit<WidgetData, "title"> & {loading?: boolean}> = ({
    leftSubHeading,
    rightSubHeading,
    children,
}) => {
    const classes = useStyles()

    return (
        <>
            <div className={classes.subHeadingRoot}>
                <span>{leftSubHeading ?? null}</span>
                <span>{rightSubHeading ?? null}</span>
            </div>
            {children ?? null}
        </>
    )
}

const WidgetCard: React.FC<Props> = ({title, leftSubHeading, rightSubHeading, tabs, children}) => {
    const classes = useStyles()
    const [tab, setTab] = useState(tabs?.[0]?.title ?? "")

    return (
        <div className={classes.root}>
            <Typography.Text className={classes.title}>{title}</Typography.Text>
            {tabs?.length ? (
                <Tabs
                    activeKey={tab}
                    onChange={setTab}
                    items={tabs.map((tab) => ({
                        key: tab.title,
                        label: tab.title,
                        children: <WidgetInnerContent {...tab} />,
                    }))}
                />
            ) : (
                <WidgetInnerContent
                    leftSubHeading={leftSubHeading}
                    rightSubHeading={rightSubHeading}
                    children={children}
                />
            )}
        </div>
    )
}

export default WidgetCard

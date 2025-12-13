import {ReactNode, useState} from "react"

import {Tabs, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        borderRadius: 12,
        border: `1px solid ${theme.colorBorderSecondary}`,
        boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        display: "flex",
        flexDirection: "column",
        padding: "16px 20px",
        backgroundColor: theme.colorBgContainer,
        height: "100%",
    },
    title: {
        fontSize: 15,
        lineHeight: 1.4,
        fontWeight: 600,
        color: theme.colorTextHeading,
        marginBottom: 4,
    },
    subHeadingRoot: {
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 12,
        minHeight: 22,
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

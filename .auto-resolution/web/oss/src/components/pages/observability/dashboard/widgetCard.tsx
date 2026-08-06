import {ReactNode, useState} from "react"

import {Tabs, Typography} from "antd"

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
    return (
        <>
            <div className="flex items-center gap-4 mb-3 min-h-[22px]">
                <span>{leftSubHeading ?? null}</span>
                <span>{rightSubHeading ?? null}</span>
            </div>
            <div className="flex flex-col flex-1 min-h-0">{children ?? null}</div>
        </>
    )
}

const WidgetCard: React.FC<Props> = ({title, leftSubHeading, rightSubHeading, tabs, children}) => {
    const [tab, setTab] = useState(tabs?.[0]?.title ?? "")

    return (
        <div className="rounded-xl border border-solid border-colorBorderSecondary shadow-[0_1px_3px_0_rgb(0_0_0_/_0.05),0_1px_2px_-1px_rgb(0_0_0_/_0.05)] flex flex-col py-4 px-5 bg-colorBgContainer h-full">
            <Typography.Text className="text-[15px] leading-[1.4] font-semibold text-colorTextHeading mb-1">
                {title}
            </Typography.Text>
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

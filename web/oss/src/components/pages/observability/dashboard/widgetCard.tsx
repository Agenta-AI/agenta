import {ReactNode, useState} from "react"

import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"

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
            <span className="text-[15px] leading-[1.4] font-semibold text-colorTextHeading mb-1">
                {title}
            </span>
            {tabs?.length ? (
                <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
                    <TabsList variant="line">
                        {tabs.map((tabItem) => (
                            <TabsTrigger key={tabItem.title} value={tabItem.title}>
                                {tabItem.title}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {tabs.map((tabItem) => (
                        <TabsContent key={tabItem.title} value={tabItem.title} keepMounted>
                            <WidgetInnerContent {...tabItem} />
                        </TabsContent>
                    ))}
                </Tabs>
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

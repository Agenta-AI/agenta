import {ReactNode} from "react"

import {Tabs, Typography, type TabsProps} from "antd"
import classNames from "classnames"

interface PageLayoutProps {
    title?: ReactNode
    titleLevel?: 1 | 2 | 3 | 4 | 5
    headerTabs?: ReactNode
    headerTabsProps?: TabsProps
    children: ReactNode
    className?: string
    headerClassName?: string
}

const PageLayout = ({
    title,
    titleLevel = 5,
    headerTabs,
    headerTabsProps,
    children,
    className,
    headerClassName,
}: PageLayoutProps) => {
    const titleText = typeof title === "string" || typeof title === "number" ? String(title) : ""
    const headerTabsContent = headerTabsProps ? (
        <Tabs {...headerTabsProps} className={classNames(headerTabsProps.className)} />
    ) : (
        headerTabs
    )

    return (
        <div className={classNames("flex w-full flex-col gap-4 p-4 self-stretch", className)}>
            {title ? (
                <div
                    className={classNames(
                        "flex items-center justify-between gap-3 h-11",
                        headerClassName,
                    )}
                >
                    <div className="min-w-0 flex-1">
                        <Typography.Title
                            className="!m-0 font-medium truncate"
                            level={titleLevel}
                            title={titleText || undefined}
                        >
                            {title}
                        </Typography.Title>
                    </div>
                    {headerTabsContent ? (
                        <div className="flex items-center justify-end [&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-tab-btn]:font-medium [&_.ant-tabs-tab-btn]:text-[14px] [&_.ant-tabs-tab-btn]:leading-[1.5714285714] [&_.ant-tabs-tab-btn]:inline-flex [&_.ant-tabs-tab-btn]:items-center [&_.ant-tabs-tab-btn]:gap-2">
                            {headerTabsContent}
                        </div>
                    ) : null}
                </div>
            ) : null}
            {children}
        </div>
    )
}

export default PageLayout

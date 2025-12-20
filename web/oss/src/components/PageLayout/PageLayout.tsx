import {ReactNode} from "react"

import {Typography} from "antd"
import classNames from "classnames"

interface PageLayoutProps {
    title?: ReactNode
    headerExtra?: ReactNode
    children: ReactNode
    className?: string
    headerClassName?: string
}

const PageLayout = ({
    title,
    headerExtra,
    children,
    className,
    headerClassName,
}: PageLayoutProps) => {
    return (
        <div className={classNames("flex w-full flex-col gap-4 p-4 self-stretch", className)}>
            {title ? (
                <div
                    className={classNames(
                        "flex items-center justify-between gap-3 h-11",
                        headerClassName,
                    )}
                >
                    <Typography.Title className="!m-0 font-medium" level={3}>
                        {title}
                    </Typography.Title>
                    {headerExtra ? <div>{headerExtra}</div> : null}
                </div>
            ) : null}
            {children}
        </div>
    )
}

export default PageLayout

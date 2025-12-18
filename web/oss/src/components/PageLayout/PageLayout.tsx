import {ReactNode} from "react"

import classNames from "classnames"
import {Typography} from "antd"

interface PageLayoutProps {
    title?: ReactNode
    headerExtra?: ReactNode
    children: ReactNode
    className?: string
}

const PageLayout = ({title, headerExtra, children, className}: PageLayoutProps) => {
    return (
        <div className={classNames("flex w-full flex-col gap-4 p-4 self-stretch", className)}>
            {title ? (
                <div className="flex items-center justify-between gap-3 h-11">
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

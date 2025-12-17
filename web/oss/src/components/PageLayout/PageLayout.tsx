import {ReactNode} from "react"

import classNames from "classnames"
import {Typography} from "antd"

interface PageLayoutProps {
    title: ReactNode
    extra?: ReactNode
    children: ReactNode
    className?: string
}

const PageLayout = ({title, extra, children, className}: PageLayoutProps) => {
    return (
        <div className={classNames("flex w-full flex-col gap-4 p-4 self-stretch", className)}>
            <div className="flex items-center justify-between gap-3 h-11">
                <Typography.Title className="!m-0 font-medium" level={3}>
                    {title}
                </Typography.Title>
                {extra ? <div className="">{extra}</div> : null}
            </div>
            {children}
        </div>
    )
}

export default PageLayout

import {memo, useMemo} from "react"

import clsx from "clsx"
import {Breadcrumb, Typography} from "antd"
import Link from "next/link"

import {Lightning} from "@phosphor-icons/react"
import packageJsonData from "../../../../package.json"
import {useStyles, type StyleProps} from "./styles"

const {Text} = Typography

export const BreadcrumbRoot = memo(() => {
    return (
        <div className="flex items-center gap-1">
            <Lightning size={16} />
            <Link href="/apps">Apps</Link>
        </div>
    )
})

export const BreadcrumbContainer = memo(({appTheme, isNewPlayground, appName}) => {
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const breadcrumbItems = useMemo(() => {
        return [
            {
                title: <BreadcrumbRoot />,
            },
            {title: appName || ""},
        ]
    }, [appName])

    return (
        <div
            className={clsx(classes.breadcrumbContainer, {
                "[&&]:!mb-0": isNewPlayground,
            })}
        >
            <Breadcrumb items={breadcrumbItems} />
            <div className={classes.topRightBar}>
                <Text>agenta v{packageJsonData.version}</Text>
            </div>
        </div>
    )
})

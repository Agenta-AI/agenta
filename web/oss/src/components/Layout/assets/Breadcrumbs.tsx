import {memo, useMemo} from "react"

import {Lightning} from "@phosphor-icons/react"
import {Breadcrumb, Typography} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"

import packageJsonData from "../../../../package.json"

import {useStyles, type StyleProps} from "./styles"

const {Text} = Typography

export const BreadcrumbRoot = memo(() => (
    <div className="flex items-center gap-1">
        <Lightning size={16} />
        <Link href="/apps">Apps</Link>
    </div>
))

export const BreadcrumbContainer = memo(
    ({
        appTheme,
        appName,
    }: {
        appTheme: string
        appName: string
    }) => {
        const classes = useStyles({themeMode: appTheme} as StyleProps)
        const router = useRouter()

        const pathSegments = useMemo(
            () => router.asPath.split("?")[0].split("/").filter(Boolean),
            [router.asPath],
        )
        const isSelectedApp = pathSegments[0] === "apps" && !!pathSegments[1]

        const breadcrumbItems = useMemo(() => {
            const items: {title: React.ReactNode; className?: string}[] = []

            if (isSelectedApp) {
                items.push({title: <BreadcrumbRoot />})
            }

            if (isSelectedApp && appName) {
                items.push({title: appName})
            }

            let displaySegments: string[] = []
            if (isSelectedApp) {
                displaySegments = pathSegments.slice(2)
            } else {
                displaySegments = pathSegments
            }

            if (displaySegments.length > 0) {
                const formatted = displaySegments.map((seg) => seg.replace(/_/g, "-")).join(" / ")

                items.push({title: formatted, className: "capitalize"})
            }

            return items
        }, [pathSegments, appName])

        return (
            <div className={classes.breadcrumbContainer}>
                <Breadcrumb items={breadcrumbItems} />
                <div className={classes.topRightBar}>
                    <Text>agenta v{packageJsonData.version}</Text>
                </div>
            </div>
        )
    },
)

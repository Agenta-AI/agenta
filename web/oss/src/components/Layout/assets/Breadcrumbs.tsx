import {memo, useMemo} from "react"

import {Lightning, Sidebar} from "@phosphor-icons/react"
import {Breadcrumb, Typography} from "antd"
import clsx from "clsx"
import {useAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"

import packageJsonData from "../../../../package.json"
import EnhancedButton from "../../Playground/assets/EnhancedButton"

import {useStyles, type StyleProps} from "./styles"

const {Text} = Typography

export const BreadcrumbRoot = memo(() => (
    <div className="flex items-center gap-1">
        <Lightning size={16} />
        <Link href="/apps">Apps</Link>
    </div>
))

export const BreadcrumbContainer = memo(
    ({appTheme, appName}: {appTheme: string; appName: string}) => {
        const classes = useStyles({themeMode: appTheme} as StyleProps)
        const router = useRouter()
        const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)

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
                <div className="flex items-center gap-4">
                    <EnhancedButton
                        type="text"
                        className="-ml-1"
                        icon={
                            <Sidebar
                                size={14}
                                className={clsx(
                                    "transition-transform",
                                    collapsed ? "rotate-180" : "",
                                )}
                            />
                        }
                        onClick={() => setCollapsed(!collapsed)}
                        tooltipProps={{
                            title: "Toggle sidebar",
                            mouseEnterDelay: 1,
                        }}
                    />
                    <Breadcrumb items={breadcrumbItems} />
                </div>
                <div className={classes.topRightBar}>
                    <Text>agenta v{packageJsonData.version}</Text>
                </div>
            </div>
        )
    },
)

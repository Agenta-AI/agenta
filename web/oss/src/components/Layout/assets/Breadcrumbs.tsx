import {memo, useEffect, useMemo} from "react"

import {Breadcrumb, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {breadcrumbAtom, type BreadcrumbAtom} from "@/oss/lib/atoms/breadcrumb"
import {useBreadcrumbs} from "@/oss/lib/hooks/useBreadcrumbs"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"
import packageJsonData from "../../../../package.json"
import EnhancedButton from "../../Playground/assets/EnhancedButton"

import {useStyles, type StyleProps} from "./styles"
import {useAppsData} from "@/oss/contexts/app.context"
import clsx from "clsx"
import TooltipWithCopyAction from "../../TooltipWithCopyAction"
import {getUniquePartOfId, isUuid} from "@/oss/lib/helpers/utils"
import {generateSegmentsForBreadcrumb} from "./utils"
import {Sidebar} from "@phosphor-icons/react"

const breadcrumbItemsGenerator = (breadcrumbs: BreadcrumbAtom): {title: React.ReactNode}[] => {
    if (!breadcrumbs) return []

    return Object.values(breadcrumbs).map((item) => {
        const title = item.href ? (
            <Link
                href={item.href}
                className={clsx([
                    "!p-0 !h-auto hover:!bg-transparent",
                    {"pointer-events-none opacity-50": item.disabled},
                ])}
            >
                <span className="flex items-center gap-1">
                    {item.icon}
                    {item.label}
                </span>
            </Link>
        ) : item.value && isUuid(item.value) ? (
            <span className="flex items-center gap-1">
                {item.icon}
                <TooltipWithCopyAction
                    title={getUniquePartOfId(item.value)}
                    copyText={getUniquePartOfId(item.value)}
                    tooltipProps={{placement: "right"}}
                >
                    <span>{isUuid(item.label) ? getUniquePartOfId(item.label) : item.label}</span>
                </TooltipWithCopyAction>
            </span>
        ) : (
            <span className="flex items-center gap-1">
                {item.icon}
                {item.label}
            </span>
        )

        return {
            title,
            ...(item.menu && {
                menu: {
                    items: breadcrumbItemsGenerator(item.menu),
                    className: "!w-full [&_.ant-dropdown-menu-title-content]:!truncate",
                },
            }),
        }
    })
}

const BreadcrumbContainer = memo(({appTheme}: {appTheme: string}) => {
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const {apps} = useAppsData()
    const router = useRouter()
    const breadcrumbs = useAtomValue(breadcrumbAtom)
    const {setBreadcrumbs, clearBreadcrumbs} = useBreadcrumbs()
    const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)

    const urlBasedBreadcrumbs = useMemo(() => {
        return generateSegmentsForBreadcrumb({
            uriPath: router.asPath,
            apps: apps.slice(0, 5),
        })
    }, [router.pathname, apps])

    useEffect(() => {
        if (Object.keys(urlBasedBreadcrumbs).length > 0) {
            setBreadcrumbs(urlBasedBreadcrumbs)
        }

        return () => {
            clearBreadcrumbs()
        }
    }, [urlBasedBreadcrumbs])

    const breadcrumbItems = useMemo(
        () => breadcrumbItemsGenerator(breadcrumbs || {}),
        [breadcrumbs],
    )

    return (
        <section className={classes.breadcrumbContainer}>
            <div className="flex items-center gap-4">
                <EnhancedButton
                    type="text"
                    className="-ml-1"
                    icon={
                        <Sidebar
                            size={14}
                            className={clsx("transition-transform", collapsed ? "rotate-180" : "")}
                        />
                    }
                    onClick={() => setCollapsed(!collapsed)}
                    tooltipProps={{
                        title: "Toggle sidebar",
                        mouseEnterDelay: 1,
                    }}
                />
                <Breadcrumb
                    items={breadcrumbItems}
                    className={clsx(
                        "[&_.ant-breadcrumb-overlay-link]:hover:!bg-transparent",
                        "[&_.ant-breadcrumb-overlay-link]:flex [&_.ant-breadcrumb-overlay-link]:items-center [&_.ant-breadcrumb-overlay-link]:gap-1",
                        "[&_.ant-dropdown-trigger:hover_.anticon-down]:rotate-180 [&_.ant-dropdown-open_.anticon-down]:rotate-180 [&_.anticon-down]:transition-transform [&_.anticon-down]:duration-200",
                    )}
                />
            </div>

            <div className={classes.topRightBar}>
                <Typography.Text>agenta v{packageJsonData.version}</Typography.Text>
            </div>
        </section>
    )
})

export default memo(BreadcrumbContainer)

import {memo, useMemo} from "react"

import {Sidebar} from "@phosphor-icons/react"
import {Breadcrumb, Typography} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue} from "jotai"
import Link from "next/link"

import {breadcrumbAtom, type BreadcrumbAtom} from "@/oss/lib/atoms/breadcrumb"
import {sidebarCollapsedAtom} from "@/oss/lib/atoms/sidebar"
import {getUniquePartOfId, isUuid} from "@/oss/lib/helpers/utils"
import {resolveOnboardingSection} from "@/oss/state/onboarding"
import {urlLocationAtom} from "@/oss/state/url"

import packageJsonData from "../../../../package.json"
import EnhancedButton from "../../Playground/assets/EnhancedButton"
import TooltipWithCopyAction from "../../TooltipWithCopyAction"
import OnboardingTriggerButton from "../../Onboarding/components/OnboardingTriggerButton"

import {useStyles, type StyleProps} from "./styles"

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
                    <span className="font-mono">
                        {isUuid(item.label) ? getUniquePartOfId(item.label) : item.label}
                    </span>
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
    const breadcrumbs = useAtomValue(breadcrumbAtom)
    const [collapsed, setCollapsed] = useAtom(sidebarCollapsedAtom)
    const userLocation = useAtomValue(urlLocationAtom)
    const breadcrumbItems = useMemo(
        () => breadcrumbItemsGenerator(breadcrumbs || {}),
        [breadcrumbs],
    )
    const showOnboardingTriggerButton = useMemo(() => {
        const normalizedSection = resolveOnboardingSection(userLocation.section)
        return (
            normalizedSection === "apps" ||
            normalizedSection === "playground" ||
            normalizedSection === "playgroundPostRun"
        )
    }, [userLocation.section])

    return (
        <section
            className={clsx(
                classes.breadcrumbContainer,
                "sticky top-0 z-10 bg-white max-w-full overflow-hidden gap-4 !px-3",
            )}
        >
            <div className="flex flex-nowrap items-center shrink-1 min-w-0">
                <EnhancedButton
                    type="text"
                    className="-ml-1 shrink-0"
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
                <div className="min-w-0 flex-1 overflow-hidden">
                    <Breadcrumb
                        items={breadcrumbItems}
                        className={clsx(
                            // Outer: single line with ellipsis when overflowing
                            "whitespace-nowrap overflow-hidden text-ellipsis w-full max-w-full",
                            "[&_ol]:flex-nowrap [&_ol]:mx-2",
                            "[&_ol_*]:min-w-[min-content]",
                            // Ensure each li can shrink and not force wrapping
                            "[&_li]:min-w-0",
                            // Prevent wrapping within link/overlay-link and enable truncation
                            "[&_.ant-breadcrumb-link]:whitespace-nowrap [&_.ant-breadcrumb-link]:overflow-hidden [&_.ant-breadcrumb-link]:text-ellipsis",
                            "[&_.ant-breadcrumb-overlay-link]:whitespace-nowrap [&_.ant-breadcrumb-overlay-link]:overflow-hidden [&_.ant-breadcrumb-overlay-link]:text-ellipsis",
                            "[&_.ant-breadcrumb-overlay-link]:hover:!bg-transparent",
                            // Keep flex for icon alignment but disallow wrapping inside
                            "[&_.ant-breadcrumb-overlay-link]:flex [&_.ant-breadcrumb-overlay-link]:items-center [&_.ant-breadcrumb-overlay-link]:gap-1",
                            "[&_.ant-dropdown-trigger:hover_.anticon-down]:rotate-180 [&_.ant-dropdown-open_.anticon-down]:rotate-180 [&_.anticon-down]:transition-transform [&_.anticon-down]:duration-200",
                        )}
                    />
                </div>
            </div>

            <div className={clsx(classes.topRightBar, "shrink-0")}>
                <OnboardingTriggerButton />
                <Typography.Text>agenta v{packageJsonData.version}</Typography.Text>
            </div>
        </section>
    )
})

export default memo(BreadcrumbContainer)

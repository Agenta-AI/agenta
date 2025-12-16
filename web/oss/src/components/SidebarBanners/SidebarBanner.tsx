import {memo} from "react"

import {X} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useRouter} from "next/router"

import {BannerConfig} from "./types"

interface SidebarBannerProps {
    banner: BannerConfig
    onDismiss?: () => void
}

const SidebarBanner = ({banner, onDismiss}: SidebarBannerProps) => {
    const router = useRouter()

    const handleActionClick = () => {
        if (banner.action?.onClick) {
            banner.action.onClick()
        } else if (banner.action?.href) {
            if (banner.action.href.startsWith("http")) {
                window.open(banner.action.href, "_blank")
            } else {
                router.push(banner.action.href)
            }
        }
    }

    // If custom content is provided, render it instead
    if (banner.customContent) {
        return (
            <section className="p-4 rounded-lg flex flex-col gap-2 bg-[#F5F7FA] relative">
                {banner.dismissible && onDismiss && (
                    <button
                        onClick={onDismiss}
                        className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 transition-colors"
                        aria-label="Dismiss banner"
                    >
                        <X size={14} className="text-gray-500" />
                    </button>
                )}
                {banner.customContent}
            </section>
        )
    }

    return (
        <section className="p-4 rounded-lg flex flex-col gap-2 bg-[#F5F7FA] relative">
            {banner.dismissible && onDismiss && (
                <button
                    onClick={onDismiss}
                    className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 transition-colors"
                    aria-label="Dismiss banner"
                >
                    <X size={14} className="text-gray-500" />
                </button>
            )}
            <Typography.Text className="text-base font-semibold pr-4">
                {banner.title}
            </Typography.Text>
            <Typography.Text className="text-[#586673] text-sm">
                {banner.description}
            </Typography.Text>
            {banner.action && (
                <Button onClick={handleActionClick} className="self-start" size="small">
                    {banner.action.label}
                </Button>
            )}
        </section>
    )
}

export default memo(SidebarBanner)

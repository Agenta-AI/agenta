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
                        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-gray-900 transition-colors hover:bg-black/5 focus:outline-none focus-visible:bg-black/5 focus-visible:outline-none"
                        aria-label="Dismiss banner"
                    >
                        <X size={16} />
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
                    className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md border-0 bg-transparent text-gray-900 transition-colors hover:bg-black/5 focus:outline-none focus-visible:bg-black/5 focus-visible:outline-none"
                    aria-label="Dismiss banner"
                >
                    <X size={16} />
                </button>
            )}
            <Typography.Text className="text-sm leading-5 font-semibold pr-10 text-gray-900">
                {banner.title}
            </Typography.Text>
            <Typography.Text className="text-[13px] leading-5 text-[#586673]">
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

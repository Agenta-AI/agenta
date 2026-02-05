import {useState} from "react"

import {GlobalOutlined} from "@ant-design/icons"
import {Button, Typography} from "antd"
import clsx from "clsx"

import {REGIONS, RegionId} from "@/oss/lib/helpers/region"

import RegionInfoModal from "./RegionInfoModal"
import {useRegionSelector} from "./useRegionSelector"

const {Text} = Typography

const selectedButtonClass =
    "!border-[var(--ant-color-primary)] !bg-[var(--ant-color-primary-bg)] !text-[var(--ant-color-primary)]"

const RegionSelector = () => {
    const {currentRegion, isSwitching, pendingRegion, switchToRegion} = useRegionSelector()
    const [isInfoOpen, setIsInfoOpen] = useState(false)

    if (!currentRegion) return null

    const renderButton = (region: (typeof REGIONS)[RegionId]) => {
        const isSelected = region.id === currentRegion
        const isLoading = isSwitching && pendingRegion === region.id

        return (
            <Button
                key={region.id}
                type="default"
                size="large"
                icon={<GlobalOutlined />}
                className={clsx("flex-1", isSelected && selectedButtonClass)}
                onClick={() => switchToRegion(region.id)}
                disabled={isSelected || isSwitching}
                loading={isLoading}
                aria-pressed={isSelected}
                aria-label={`${region.label} region`}
            >
                {region.label}
            </Button>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <Text className="text-sm font-medium">Data Residency</Text>
                <Button
                    type="link"
                    className="!h-auto !p-0 !text-xs !text-colorTextSecondary hover:!text-colorText"
                    onClick={() => setIsInfoOpen(true)}
                >
                    Learn more
                </Button>
            </div>
            <div className="flex gap-2">{Object.values(REGIONS).map(renderButton)}</div>
            <RegionInfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
        </div>
    )
}

export default RegionSelector

import {Component, ReactNode, useState} from "react"

import {GlobalOutlined} from "@ant-design/icons"
import {Button, Typography} from "antd"
import clsx from "clsx"

import {REGIONS, RegionId} from "@/oss/lib/helpers/region"

import RegionInfoModal from "./RegionInfoModal"
import {useRegionSelector} from "./useRegionSelector"

const {Text} = Typography

const selectedButtonClass =
    "!border-[var(--ant-color-primary)] !bg-[var(--ant-color-primary-bg)] !text-[var(--ant-color-primary)]"

// ---------------------------------------------------------------------------
// Error boundary – if RegionSelector throws, the auth page still works.
// ---------------------------------------------------------------------------

class RegionSelectorBoundary extends Component<{children: ReactNode}, {hasError: boolean}> {
    state = {hasError: false}

    static getDerivedStateFromError() {
        return {hasError: true}
    }

    render() {
        if (this.state.hasError) return null
        return this.props.children
    }
}

// ---------------------------------------------------------------------------
// Region button
// ---------------------------------------------------------------------------

interface RegionButtonProps {
    id: RegionId
    label: string
    isSelected: boolean
    isLoading: boolean
    disabled: boolean
    onSwitch: (id: RegionId) => void
}

const RegionButton = ({
    id,
    label,
    isSelected,
    isLoading,
    disabled,
    onSwitch,
}: RegionButtonProps) => (
    <Button
        type="default"
        size="large"
        icon={<GlobalOutlined />}
        className={clsx("flex-1", isSelected && selectedButtonClass)}
        onClick={() => onSwitch(id)}
        disabled={disabled}
        loading={isLoading}
        role="radio"
        aria-checked={isSelected}
        aria-label={`${label} region`}
    >
        {label}
    </Button>
)

// ---------------------------------------------------------------------------
// Region selector
// ---------------------------------------------------------------------------

const RegionSelector = () => {
    const {currentRegion, isSwitching, pendingRegion, switchToRegion} = useRegionSelector()
    const [isInfoOpen, setIsInfoOpen] = useState(false)

    if (!currentRegion) return null

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
                <Text className="text-sm font-medium">Data Residency</Text>
                <Button
                    type="link"
                    className="!h-auto !p-0 !text-xs !text-colorTextSecondary hover:!text-colorText"
                    onClick={() => setIsInfoOpen(true)}
                    aria-haspopup="dialog"
                >
                    Learn more
                </Button>
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label="Data residency region">
                {(Object.entries(REGIONS) as [RegionId, (typeof REGIONS)[RegionId]][]).map(
                    ([id, region]) => (
                        <RegionButton
                            key={id}
                            id={id}
                            label={region.label}
                            isSelected={id === currentRegion}
                            isLoading={isSwitching && pendingRegion === id}
                            disabled={id === currentRegion || isSwitching}
                            onSwitch={switchToRegion}
                        />
                    ),
                )}
            </div>
            <RegionInfoModal open={isInfoOpen} onClose={() => setIsInfoOpen(false)} />
        </div>
    )
}

const SafeRegionSelector = () => (
    <RegionSelectorBoundary>
        <RegionSelector />
    </RegionSelectorBoundary>
)

export default SafeRegionSelector

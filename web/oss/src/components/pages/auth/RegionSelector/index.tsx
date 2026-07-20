import {Component, ReactNode, useState} from "react"

import {GlobalOutlined} from "@ant-design/icons"
import clsx from "clsx"

import {REGIONS, RegionId} from "@/oss/lib/helpers/region"

import RegionInfoModal from "./RegionInfoModal"
import {useRegionSelector} from "./useRegionSelector"

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
// Region pill
// ---------------------------------------------------------------------------

interface RegionButtonProps {
    id: RegionId
    label: string
    isSelected: boolean
    disabled: boolean
    onSwitch: (id: RegionId) => void
}

const RegionButton = ({id, label, isSelected, disabled, onSwitch}: RegionButtonProps) => (
    <button
        type="button"
        className={clsx("auth-pill", isSelected && "auth-pill-selected")}
        onClick={() => onSwitch(id)}
        disabled={disabled}
        role="radio"
        aria-checked={isSelected}
        aria-label={`${label} region`}
    >
        <GlobalOutlined className="text-sm" />
        {label}
    </button>
)

// ---------------------------------------------------------------------------
// Region selector
// ---------------------------------------------------------------------------

const RegionSelector = () => {
    const {currentRegion, isSwitching, switchToRegion} = useRegionSelector()
    const [isInfoOpen, setIsInfoOpen] = useState(false)

    if (!currentRegion) return null

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="auth-label">Data Residency</span>
                <button
                    type="button"
                    className="auth-link"
                    onClick={() => setIsInfoOpen(true)}
                    aria-haspopup="dialog"
                >
                    Learn more
                </button>
            </div>
            <div className="flex gap-2" role="radiogroup" aria-label="Data residency region">
                {(Object.entries(REGIONS) as [RegionId, (typeof REGIONS)[RegionId]][]).map(
                    ([id, region]) => (
                        <RegionButton
                            key={id}
                            id={id}
                            label={region.label}
                            isSelected={id === currentRegion}
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

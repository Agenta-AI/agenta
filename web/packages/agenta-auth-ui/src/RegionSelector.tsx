import {Component, useState, type ReactNode} from "react"

import {REGIONS, type RegionId} from "@agenta/auth"
import {Globe} from "@phosphor-icons/react"
import clsx from "clsx"

import {useRegionSelector} from "./useRegionSelector"

// ---------------------------------------------------------------------------
// Error boundary – if RegionSelector throws, the sign-in page still works.
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
        <Globe size={14} />
        {label}
    </button>
)

// ---------------------------------------------------------------------------
// Region info copy — the desktop shows it in a modal, /m inline; one text.
// ---------------------------------------------------------------------------

export const RegionInfoText = ({className}: {className?: string}) => (
    <div className={clsx("flex flex-col gap-3", className)}>
        <p className="m-0">Agenta Cloud is available in two regions:</p>
        <ul className="m-0 list-disc pl-5">
            {(Object.entries(REGIONS) as [RegionId, (typeof REGIONS)[RegionId]][]).map(
                ([id, region]) => (
                    <li key={id}>
                        {region.label}: {region.location}
                    </li>
                ),
            )}
        </ul>
        <p className="m-0">
            Regions are completely isolated. No data is shared between regions. Choose a region
            based on data residency requirements and latency needs.
        </p>
        <p className="m-0">
            You can have accounts in multiple regions. Each requires a separate sign-up.
        </p>
    </div>
)

// ---------------------------------------------------------------------------
// Region selector
// ---------------------------------------------------------------------------

export interface RegionSelectorProps {
    /**
     * What "Learn more" does. The desktop opens its modal; omit it to expand
     * {@link RegionInfoText} inline under the pills (what /m does).
     */
    onLearnMore?: () => void
}

const RegionSelectorInner = ({onLearnMore}: RegionSelectorProps) => {
    const {currentRegion, isSwitching, switchToRegion} = useRegionSelector()
    const [isInfoOpen, setIsInfoOpen] = useState(false)

    if (!currentRegion) return null

    const learnMore = onLearnMore ?? (() => setIsInfoOpen((open) => !open))

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <span className="auth-label">Data Residency</span>
                <button
                    type="button"
                    className="auth-link"
                    onClick={learnMore}
                    aria-haspopup={onLearnMore ? "dialog" : undefined}
                    aria-expanded={onLearnMore ? undefined : isInfoOpen}
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
            {!onLearnMore && isInfoOpen ? <RegionInfoText className="auth-subline" /> : null}
        </div>
    )
}

export const RegionSelector = (props: RegionSelectorProps) => (
    <RegionSelectorBoundary>
        <RegionSelectorInner {...props} />
    </RegionSelectorBoundary>
)

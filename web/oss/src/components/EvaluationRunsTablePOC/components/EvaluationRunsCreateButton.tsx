import {useCallback, useEffect, useMemo} from "react"

import {CaretDown, Check, Plus} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Tooltip, type MenuProps} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {
    evaluationRunsCreateModalOpenAtom,
    evaluationRunsCreateSelectedTypeAtom,
    evaluationRunsCreateTypePreferenceAtom,
    evaluationRunsTableHeaderStateAtom,
} from "../atoms/view"
import type {ConcreteEvaluationRunKind} from "../types"

type SupportedCreateType = Extract<ConcreteEvaluationRunKind, "auto" | "human" | "online">

const SUPPORTED_CREATE_TYPES: SupportedCreateType[] = ["auto", "human", "online"]

const createTypeCopy: Record<
    SupportedCreateType,
    {title: string; description: string; short: string}
> = {
    auto: {
        title: "Auto evaluation",
        description: "Run testsets with configured evaluators for fast iteration.",
        short: "Auto",
    },
    human: {
        title: "Human evaluation",
        description: "Collect human votes or ratings on evaluation outputs.",
        short: "Human",
    },
    online: {
        title: "Live evaluation",
        description: "Send production traffic to variants and compare live metrics.",
        short: "Live",
    },
}

const isSupportedCreateType = (value: string): value is SupportedCreateType =>
    SUPPORTED_CREATE_TYPES.includes(value as SupportedCreateType)

const EvaluationRunsCreateButton = () => {
    const {createEnabled, createTooltip, evaluationKind, defaultCreateType, scope} = useAtomValue(
        evaluationRunsTableHeaderStateAtom,
    )
    const isAppScoped = scope === "app"
    const [createOpen, setCreateOpen] = useAtom(evaluationRunsCreateModalOpenAtom)
    const [selectedCreateType, setSelectedCreateType] = useAtom(
        evaluationRunsCreateSelectedTypeAtom,
    )
    const [createTypePreference, setCreateTypePreference] = useAtom(
        evaluationRunsCreateTypePreferenceAtom,
    )
    const isAllTab = evaluationKind === "all"

    useEffect(() => {
        if (!createEnabled && createOpen) {
            setCreateOpen(false)
        }
    }, [createEnabled, createOpen, setCreateOpen])

    useEffect(() => {
        if (!isAllTab && defaultCreateType && selectedCreateType !== defaultCreateType) {
            setSelectedCreateType(defaultCreateType)
        }
    }, [defaultCreateType, isAllTab, selectedCreateType, setSelectedCreateType])

    useEffect(() => {
        if (!isAllTab) return
        const normalizedPreference = isSupportedCreateType(createTypePreference)
            ? createTypePreference
            : "auto"
        if (!isSupportedCreateType(createTypePreference)) {
            setCreateTypePreference(normalizedPreference)
        }
        if (selectedCreateType !== normalizedPreference) {
            setSelectedCreateType(normalizedPreference)
        }
    }, [
        createTypePreference,
        isAllTab,
        selectedCreateType,
        setCreateTypePreference,
        setSelectedCreateType,
    ])

    const handlePrimaryClick = useCallback(() => {
        if (!createEnabled) return
        setCreateOpen(true)
    }, [createEnabled, setCreateOpen])

    const handleMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            if (!isSupportedCreateType(key)) return
            setSelectedCreateType(key)
            setCreateTypePreference(key)
            if (!createEnabled) return
            setCreateOpen(true)
        },
        [createEnabled, setCreateOpen, setCreateTypePreference, setSelectedCreateType],
    )

    const dropdownMenuItems = useMemo<MenuProps["items"]>(() => {
        if (!isAllTab) return []
        // Filter out "online" (Live Evaluation) in app-scoped views
        const availableTypes = isAppScoped
            ? SUPPORTED_CREATE_TYPES.filter((type) => type !== "online")
            : SUPPORTED_CREATE_TYPES
        return availableTypes.map((type) => {
            const copy = createTypeCopy[type]
            const isActive = selectedCreateType === type
            return {
                key: type,
                label: (
                    <div className="flex items-start gap-2 py-1">
                        <div className="mt-0.5 h-4 w-4 text-primary">
                            {isActive ? <Check size={14} weight="bold" /> : null}
                        </div>
                        <div className="flex flex-col">
                            <span className="font-medium text-gray-900">{copy.title}</span>
                            <span className="text-gray-500">{copy.description}</span>
                        </div>
                    </div>
                ),
            }
        })
    }, [isAllTab, isAppScoped, selectedCreateType])

    const buttonLabel = useMemo(() => {
        if (!isAllTab) return "New Evaluation"
        const shortLabel = isSupportedCreateType(selectedCreateType)
            ? createTypeCopy[selectedCreateType]?.short
            : null
        return shortLabel ? `New ${shortLabel} Evaluation` : "New Evaluation"
    }, [isAllTab, selectedCreateType])

    return (
        <Tooltip title={createTooltip ?? undefined}>
            <div className="inline-flex">
                {isAllTab ? (
                    <Space.Compact>
                        <Button
                            type="primary"
                            icon={<Plus size={16} />}
                            disabled={!createEnabled}
                            onClick={handlePrimaryClick}
                        >
                            {buttonLabel}
                        </Button>
                        <Dropdown
                            menu={{items: dropdownMenuItems, onClick: handleMenuClick}}
                            disabled={!createEnabled}
                        >
                            <Button type="primary" icon={<CaretDown size={14} />} />
                        </Dropdown>
                    </Space.Compact>
                ) : (
                    <Button
                        type="primary"
                        icon={<Plus size={16} />}
                        disabled={!createEnabled}
                        onClick={handlePrimaryClick}
                    >
                        New Evaluation
                    </Button>
                )}
            </div>
        </Tooltip>
    )
}

export default EvaluationRunsCreateButton

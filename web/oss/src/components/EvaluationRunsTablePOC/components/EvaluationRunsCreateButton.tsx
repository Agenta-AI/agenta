import {useCallback, useEffect, useMemo} from "react"

import {PlusIcon} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip, type ButtonProps, type MenuProps} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {
    evaluationRunsCreateModalOpenAtom,
    evaluationRunsCreateSelectedTypeAtom,
    evaluationRunsCreateTypePreferenceAtom,
    evaluationRunsTableHeaderStateAtom,
} from "../atoms/view"
import type {ConcreteEvaluationRunKind} from "../types"

type SupportedCreateType = Extract<
    ConcreteEvaluationRunKind,
    "auto" | "human" | "online" | "custom"
>

const SUPPORTED_CREATE_TYPES: SupportedCreateType[] = ["auto", "human", "online", "custom"]

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
    custom: {
        title: "SDK evaluation",
        description: "Run evaluations programmatically using the Agenta SDK.",
        short: "SDK",
    },
}

const isSupportedCreateType = (value: unknown): value is SupportedCreateType => {
    return typeof value === "string" && (SUPPORTED_CREATE_TYPES as string[]).includes(value)
}

const FALLBACK_CREATE_TYPE: SupportedCreateType = "auto"

interface EvaluationRunsCreateButtonProps {
    label?: string
    size?: ButtonProps["size"]
    className?: string
}

const EvaluationRunsCreateButton = ({
    label,
    size = "middle",
    className,
}: EvaluationRunsCreateButtonProps) => {
    const {createEnabled, createTooltip, evaluationKind, defaultCreateType, scope} = useAtomValue(
        evaluationRunsTableHeaderStateAtom,
    )
    const isAllTab = evaluationKind === "all"
    const isAppScoped = scope === "app"
    const [createOpen, setCreateOpen] = useAtom(evaluationRunsCreateModalOpenAtom)
    const [selectedCreateType, setSelectedCreateType] = useAtom(
        evaluationRunsCreateSelectedTypeAtom,
    )
    const [createTypePreference, setCreateTypePreference] = useAtom(
        evaluationRunsCreateTypePreferenceAtom,
    )

    const availableTypes = useMemo<SupportedCreateType[]>(() => {
        if (!isAllTab) return []
        if (isAppScoped) return SUPPORTED_CREATE_TYPES.filter((t) => t !== "online")
        return SUPPORTED_CREATE_TYPES
    }, [isAllTab, isAppScoped])

    const normalizeAllTabType = useCallback(
        (value: unknown): SupportedCreateType => {
            const candidate = isSupportedCreateType(value) ? value : FALLBACK_CREATE_TYPE
            return availableTypes.includes(candidate)
                ? candidate
                : (availableTypes[0] ?? FALLBACK_CREATE_TYPE)
        },
        [availableTypes],
    )

    useEffect(() => {
        if (!createEnabled && createOpen) setCreateOpen(false)
    }, [createEnabled, createOpen, setCreateOpen])

    useEffect(() => {
        if (isAllTab) return
        if (!defaultCreateType) return
        if (selectedCreateType !== defaultCreateType) setSelectedCreateType(defaultCreateType)
    }, [defaultCreateType, isAllTab, selectedCreateType, setSelectedCreateType])

    useEffect(() => {
        if (!isAllTab) return

        const normalized = normalizeAllTabType(createTypePreference)

        if (createTypePreference !== normalized) setCreateTypePreference(normalized)
        if (selectedCreateType !== normalized) setSelectedCreateType(normalized)
    }, [
        isAllTab,
        createTypePreference,
        selectedCreateType,
        setCreateTypePreference,
        setSelectedCreateType,
        normalizeAllTabType,
    ])

    const openCreateModal = useCallback(() => {
        if (!createEnabled) return
        setCreateOpen(true)
    }, [createEnabled, setCreateOpen])

    const handleMenuClick = useCallback<NonNullable<MenuProps["onClick"]>>(
        ({key}) => {
            if (!isSupportedCreateType(key)) return

            const normalized = normalizeAllTabType(key)

            setSelectedCreateType(normalized)
            setCreateTypePreference(normalized)
            openCreateModal()
        },
        [normalizeAllTabType, openCreateModal, setCreateTypePreference, setSelectedCreateType],
    )

    const menuItems = useMemo<MenuProps["items"]>(() => {
        if (!isAllTab) return []

        return availableTypes.map((type) => {
            const copy = createTypeCopy[type]
            return {
                key: type,
                label: (
                    <div className="flex flex-col py-1">
                        <span className="font-medium text-gray-900">{copy.title}</span>
                        <span className="text-gray-500">{copy.description}</span>
                    </div>
                ),
            }
        })
    }, [availableTypes, isAllTab])

    return (
        <Tooltip title={createTooltip ?? undefined}>
            <div className="inline-flex">
                {isAllTab ? (
                    <Dropdown
                        trigger={["click"]}
                        disabled={!createEnabled}
                        menu={{items: menuItems, onClick: handleMenuClick}}
                    >
                        <Button
                            type="primary"
                            icon={<PlusIcon size={16} />}
                            disabled={!createEnabled}
                            size={size}
                            className={className}
                        >
                            {label ?? "New Evaluation"}
                        </Button>
                    </Dropdown>
                ) : (
                    <Button
                        type="primary"
                        icon={<PlusIcon size={16} />}
                        disabled={!createEnabled}
                        onClick={openCreateModal}
                        size={size}
                        className={className}
                    >
                        {label ?? "New evaluation"}
                    </Button>
                )}
            </div>
        </Tooltip>
    )
}

export default EvaluationRunsCreateButton

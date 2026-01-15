/**
 * EntityCascader Component
 *
 * Ant Design Cascader wrapper for hierarchical entity selection.
 * Uses lazy loading for child entities.
 * Supports inline "create new" mode for creating new entities.
 */

import React, {useState, useEffect, useMemo, useCallback, useRef} from "react"

import {Cascader, Input} from "antd"
import type {InputRef} from "antd"
import type {CascaderProps, DefaultOptionType} from "antd/es/cascader"
import {Plus, X} from "lucide-react"

import {resolveAdapter} from "../adapters/createAdapter"
import {useLazyChildren, type CascaderOption} from "../hooks/useLazyChildren"
import type {EntitySelectionAdapter, EntitySelectionResult} from "../types"

// ============================================================================
// CASCADER OPTION RENDER COMPONENT
// ============================================================================

/**
 * Custom option renderer for cascader items
 * Provides consistent styling with EntityListItem component
 */
function CascaderOptionItem({
    option,
    isSelected,
    compact = false,
}: {
    option: CascaderOption
    isSelected: boolean
    compact?: boolean
}) {
    const displayContent = option.labelNode ?? option.label

    // Base styling consistent with ListItem component
    // Compact mode uses smaller padding
    const baseClasses = compact
        ? "flex items-center w-full py-1 px-2 -mx-2 -my-0.5 rounded-md transition-colors"
        : "flex items-center w-full py-2 px-3 -mx-3 -my-1 rounded-md transition-colors"
    const stateClasses = isSelected
        ? "bg-blue-50" // Selected: light blue bg (matching ListItem)
        : "" // Default handled by Ant Design hover

    return (
        <div className={`${baseClasses} ${stateClasses}`}>
            <div className="flex-1 min-w-0 truncate">{displayContent}</div>
        </div>
    )
}

// ============================================================================
// TYPES
// ============================================================================

export interface EntityCascaderProps<TSelection = EntitySelectionResult> {
    /**
     * The adapter defining the entity hierarchy
     */
    adapter: EntitySelectionAdapter<TSelection> | string

    /**
     * Current selected value (array of IDs)
     */
    value?: string[]

    /**
     * Callback when selection changes
     */
    onChange?: (value: string[], selection: TSelection | null) => void

    /**
     * Placeholder text
     */
    placeholder?: string

    /**
     * Whether the cascader is disabled
     */
    disabled?: boolean

    /**
     * Show search in cascader
     * @default true
     */
    showSearch?: boolean

    /**
     * Allow clearing the selection
     * @default true
     */
    allowClear?: boolean

    /**
     * Size of the cascader
     * @default "middle"
     */
    size?: "small" | "middle" | "large"

    /**
     * Additional CSS class
     */
    className?: string

    /**
     * Style object
     */
    style?: React.CSSProperties

    /**
     * Custom display render
     */
    displayRender?: CascaderProps<CascaderOption>["displayRender"]

    /**
     * Expand trigger (click or hover)
     * @default "click"
     */
    expandTrigger?: "click" | "hover"

    /**
     * Use compact item display in dropdown
     * Reduces padding and uses smaller text for denser lists
     * @default false
     */
    compactItems?: boolean

    // ========================================================================
    // INLINE CREATE MODE PROPS
    // ========================================================================

    /**
     * Enable inline "Create New" functionality.
     * When true, shows a "Create New" option in the dropdown that switches
     * the cascader to an inline input mode.
     * @default false
     */
    allowCreate?: boolean

    /**
     * Label for the "Create New" option in the dropdown
     * @default "Create New"
     */
    createLabel?: string

    /**
     * Placeholder for the inline create input
     * @default "Enter name..."
     */
    createPlaceholder?: string

    /**
     * Whether the component is currently in create mode (controlled)
     * If not provided, the component manages this state internally
     */
    isCreateMode?: boolean

    /**
     * The current value of the new entity name (controlled)
     * If not provided, the component manages this state internally
     */
    createValue?: string

    /**
     * Callback when create mode changes
     */
    onCreateModeChange?: (isCreateMode: boolean) => void

    /**
     * Callback when the create input value changes
     */
    onCreateValueChange?: (value: string) => void

    /**
     * Callback when create is confirmed (e.g., Enter key pressed)
     * If not provided, the component will call onChange with ["__create__"] and the name
     */
    onCreateConfirm?: (name: string) => void
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Ant Design Cascader for hierarchical entity selection
 *
 * @example
 * ```tsx
 * <EntityCascader
 *   adapter={testsetAdapter}
 *   value={selectedPath}
 *   onChange={(path, selection) => {
 *     setSelectedPath(path)
 *     console.log('Selected:', selection)
 *   }}
 *   placeholder="Select testset and revision"
 *   showSearch
 * />
 * ```
 */
// Special value used to identify "create new" selection
const CREATE_NEW_VALUE = "__create__"

export function EntityCascader<TSelection = EntitySelectionResult>({
    adapter: adapterOrName,
    value,
    onChange,
    placeholder = "Select...",
    disabled = false,
    showSearch = true,
    allowClear = true,
    size = "middle",
    className,
    style,
    displayRender,
    expandTrigger = "click",
    compactItems = false,
    // Inline create mode props
    allowCreate = false,
    createLabel = "Create New",
    createPlaceholder = "Enter name...",
    isCreateMode: controlledIsCreateMode,
    createValue: controlledCreateValue,
    onCreateModeChange,
    onCreateValueChange,
    onCreateConfirm,
}: EntityCascaderProps<TSelection>) {
    const [options, setOptions] = useState<CascaderOption[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Internal state for create mode (used when not controlled)
    const [internalIsCreateMode, setInternalIsCreateMode] = useState(false)
    const [internalCreateValue, setInternalCreateValue] = useState("")

    // Use controlled or internal state
    const isCreateMode = controlledIsCreateMode ?? internalIsCreateMode
    const createInputValue = controlledCreateValue ?? internalCreateValue

    const inputRef = useRef<InputRef>(null)

    const adapter = useMemo(
        () => resolveAdapter(adapterOrName) as EntitySelectionAdapter<EntitySelectionResult>,
        [adapterOrName],
    )

    const {loadData, loadRootOptions} = useLazyChildren({
        adapter,
    })

    // Load root options on mount
    useEffect(() => {
        setIsLoading(true)
        loadRootOptions()
            .then((rootOptions) => {
                // Add "Create New" option at the top if allowCreate is enabled
                if (allowCreate) {
                    const createOption: CascaderOption = {
                        value: CREATE_NEW_VALUE,
                        label: (
                            <span className="flex items-center gap-2">
                                <Plus size={14} />
                                {createLabel}
                            </span>
                        ),
                        isLeaf: true,
                        path: [],
                    }
                    setOptions([createOption, ...rootOptions])
                } else {
                    setOptions(rootOptions)
                }
            })
            .finally(() => {
                setIsLoading(false)
            })
    }, [loadRootOptions, allowCreate, createLabel])

    // Focus input when entering create mode
    useEffect(() => {
        if (isCreateMode && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isCreateMode])

    // Handle entering create mode
    const enterCreateMode = useCallback(() => {
        if (controlledIsCreateMode === undefined) {
            setInternalIsCreateMode(true)
        }
        onCreateModeChange?.(true)
    }, [controlledIsCreateMode, onCreateModeChange])

    // Handle exiting create mode
    const exitCreateMode = useCallback(() => {
        if (controlledIsCreateMode === undefined) {
            setInternalIsCreateMode(false)
            setInternalCreateValue("")
        }
        onCreateModeChange?.(false)
        onCreateValueChange?.("")
    }, [controlledIsCreateMode, onCreateModeChange, onCreateValueChange])

    // Handle create input change
    const handleCreateInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value
            if (controlledCreateValue === undefined) {
                setInternalCreateValue(newValue)
            }
            onCreateValueChange?.(newValue)
        },
        [controlledCreateValue, onCreateValueChange],
    )

    // Handle create confirmation
    const handleCreateConfirm = useCallback(() => {
        if (!createInputValue.trim()) return

        if (onCreateConfirm) {
            onCreateConfirm(createInputValue.trim())
        } else {
            // Default behavior: call onChange with special create value
            onChange?.([CREATE_NEW_VALUE], null)
        }
    }, [createInputValue, onCreateConfirm, onChange])

    // Handle key press in create input
    const handleCreateKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault()
                handleCreateConfirm()
            } else if (e.key === "Escape") {
                e.preventDefault()
                exitCreateMode()
            }
        },
        [handleCreateConfirm, exitCreateMode],
    )

    // Handle selection change
    const handleChange = useCallback(
        (selectedValue: (string | number)[], selectedOptions: DefaultOptionType[]) => {
            const pathValue = selectedValue.map(String)

            // Check if "Create New" was selected
            if (pathValue[0] === CREATE_NEW_VALUE) {
                enterCreateMode()
                return
            }

            // Build selection if complete
            if (selectedOptions.length > 0) {
                const lastOption = selectedOptions[selectedOptions.length - 1] as CascaderOption
                const path = lastOption.path ?? []

                if (adapter.isComplete(path)) {
                    const selection = adapter.toSelection(path, lastOption.entity)
                    onChange?.(pathValue, selection as TSelection)
                    return
                }
            }

            onChange?.(pathValue, null)
        },
        [adapter, onChange, enterCreateMode],
    )

    // Custom loadData that updates options immutably
    const handleLoadData = useCallback(
        async (selectedOptions: DefaultOptionType[]) => {
            const cascaderOptions = selectedOptions as CascaderOption[]
            await loadData(cascaderOptions)

            // Force re-render by updating options state
            setOptions((prev) => [...prev])
        },
        [loadData],
    )

    // Default display render
    const defaultDisplayRender = useCallback((labels: string[]) => {
        return labels.join(" / ")
    }, [])

    // Search filter
    const searchFilter = useCallback((inputValue: string, path: DefaultOptionType[]) => {
        return path.some((option) =>
            String(option.label).toLowerCase().includes(inputValue.toLowerCase()),
        )
    }, [])

    // Render inline create input when in create mode
    if (isCreateMode) {
        return (
            <Input
                ref={inputRef}
                value={createInputValue}
                onChange={handleCreateInputChange}
                onKeyDown={handleCreateKeyDown}
                placeholder={createPlaceholder}
                disabled={disabled}
                size={size}
                className={className}
                style={style}
                suffix={
                    <X
                        size={14}
                        className="cursor-pointer text-gray-400 hover:text-gray-600"
                        onClick={exitCreateMode}
                    />
                }
            />
        )
    }

    return (
        <Cascader
            options={options}
            value={value}
            onChange={handleChange}
            loadData={handleLoadData}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            showSearch={showSearch ? {filter: searchFilter} : false}
            allowClear={allowClear}
            size={size}
            className={className}
            style={style}
            displayRender={displayRender ?? defaultDisplayRender}
            expandTrigger={expandTrigger}
            changeOnSelect={false}
            loading={isLoading}
            popupClassName={[
                "[&_.ant-cascader-menu-item]:!rounded-md",
                "[&_.ant-cascader-menu-item:hover]:!bg-gray-50",
                "[&_.ant-cascader-menu-item-active]:!bg-blue-50",
                // Compact mode: reduce menu item padding
                compactItems && "[&_.ant-cascader-menu-item]:!py-1",
            ]
                .filter(Boolean)
                .join(" ")}
            popupMenuColumnStyle={{fontWeight: 400}}
            optionRender={(option) => {
                const cascaderOption = option as unknown as CascaderOption
                const isSelected = value?.includes(cascaderOption.value)
                return (
                    <CascaderOptionItem
                        option={cascaderOption}
                        isSelected={isSelected ?? false}
                        compact={compactItems}
                    />
                )
            }}
        />
    )
}

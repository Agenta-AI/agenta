import React, {useCallback, useMemo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CaretDown} from "@phosphor-icons/react"
import {useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"
import {CheckCircle, LoaderCircle, XCircle} from "lucide-react"

export const dropdownSelectionAtomFamily = atomFamily((storageKey: string) =>
    atomWithStorage<string | null>(`agenta:dropdown:${storageKey}`, null),
)

function useDropdownSelection(storageKey: string | undefined, defaultKey: string) {
    const atom = storageKey ? dropdownSelectionAtomFamily(storageKey) : null
    const [storedKey, setStoredKey] = useAtom(atom ?? dropdownSelectionAtomFamily("__noop__"))

    if (!storageKey) {
        return [defaultKey, () => {}] as const
    }

    const effectiveKey = storedKey ?? defaultKey
    return [effectiveKey, setStoredKey] as const
}

export type DropdownButtonOptionStatus = "idle" | "running" | "success" | "error"

export interface DropdownButtonOption {
    key: string
    label: React.ReactNode
    disabled?: boolean
    icon?: React.ReactNode
    status?: DropdownButtonOptionStatus
}

export interface DropdownButtonProps {
    label?: React.ReactNode
    icon?: React.ReactNode
    options: DropdownButtonOption[]
    onClick?: () => void
    onOptionSelect?: (key: string) => void
    size?: "small" | "middle" | "large"
    type?: "default" | "primary" | "dashed" | "link" | "text"
    className?: string
    disabled?: boolean
    dropdownDisabled?: boolean
    trigger?: ("click" | "hover" | "contextMenu")[]
    placement?: "bottom" | "bottomLeft" | "bottomRight" | "top" | "topLeft" | "topRight"
    dropdownIcon?: React.ReactNode
    storageKey?: string
    defaultSelectedKey?: string
    loading?: boolean
}

const sizeMap: Record<string, "sm" | "default" | "lg"> = {
    small: "sm",
    middle: "default",
    large: "lg",
}

export function DropdownButton({
    label,
    icon,
    options,
    onClick,
    onOptionSelect,
    size = "middle",
    type = "default",
    className = "",
    disabled = false,
    dropdownDisabled = false,
    trigger = ["hover"],
    placement = "bottomRight",
    dropdownIcon,
    storageKey,
    defaultSelectedKey,
    loading = false,
}: DropdownButtonProps) {
    const defaultKey = defaultSelectedKey ?? options[0]?.key ?? ""
    const [selectedKey, setSelectedKey] = useDropdownSelection(storageKey, defaultKey)

    const handleOptionSelect = useCallback(
        (key: string) => {
            if (storageKey) {
                setSelectedKey(key)
            }
            onOptionSelect?.(key)
        },
        [storageKey, setSelectedKey, onOptionSelect],
    )

    const handleMainClick = useCallback(() => {
        if (storageKey) {
            const selectedOption = options.find((opt) => opt.key === selectedKey)
            if (selectedOption && !selectedOption.disabled) {
                handleOptionSelect(selectedKey)
            } else {
                const firstAvailable = options.find((opt) => !opt.disabled)
                if (firstAvailable) {
                    handleOptionSelect(firstAvailable.key)
                }
            }
        } else {
            onClick?.()
        }
    }, [storageKey, options, selectedKey, handleOptionSelect, onClick])

    const effectiveLabel = useMemo(() => {
        if (storageKey) {
            const selectedOption = options.find((opt) => opt.key === selectedKey)
            if (selectedOption && !selectedOption.disabled) {
                return selectedOption.label
            }
            const firstAvailable = options.find((opt) => !opt.disabled)
            return firstAvailable?.label ?? label
        }
        return label
    }, [storageKey, options, selectedKey, label])

    const primSize = sizeMap[size] ?? "default"
    const variant =
        type === "primary"
            ? "default"
            : type === "dashed"
              ? "outline"
              : type === "link"
                ? "link"
                : "outline"
    const chevronIcon = dropdownIcon ?? <CaretDown size={10} weight="bold" />

    const align =
        placement === "bottomRight" || placement === "topRight"
            ? "end"
            : placement === "bottomLeft" || placement === "topLeft"
              ? "start"
              : "center"
    const side =
        placement === "top" || placement === "topLeft" || placement === "topRight"
            ? "top"
            : "bottom"

    return (
        <div className={`flex ${className}`}>
            <Button
                variant={variant}
                size={primSize}
                className="flex items-center gap-1 rounded-r-none border-r-0"
                onClick={handleMainClick}
                disabled={disabled}
            >
                {loading ? <LoaderCircle size={14} className="animate-spin" /> : icon}
                {effectiveLabel}
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger
                    disabled={dropdownDisabled || disabled}
                    className={`inline-flex shrink-0 items-center justify-center border border-border bg-background hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 rounded-l-none ${primSize === "sm" ? "h-7 px-1" : primSize === "lg" ? "h-9 px-1.5" : "h-8 px-1"}`}
                >
                    {chevronIcon}
                </DropdownMenuTrigger>
                <DropdownMenuContent align={align} side={side}>
                    {options.map((option) => {
                        const hasActiveStatus = option.status && option.status !== "idle"
                        const iconElement = hasActiveStatus ? (
                            <OptionStatusIndicator status={option.status!} />
                        ) : (
                            option.icon
                        )
                        return (
                            <DropdownMenuItem
                                key={option.key}
                                disabled={option.disabled || option.status === "running"}
                                onClick={() => handleOptionSelect(option.key)}
                            >
                                <span className="inline-flex items-center gap-2">
                                    {iconElement}
                                    <span>{option.label}</span>
                                </span>
                            </DropdownMenuItem>
                        )
                    })}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

function OptionStatusIndicator({status}: {status: DropdownButtonOptionStatus}) {
    switch (status) {
        case "running":
            return <LoaderCircle size={14} className="animate-spin text-blue-500" />
        case "success":
            return <CheckCircle size={14} className="text-green-500" />
        case "error":
            return <XCircle size={14} className="text-red-500" />
        default:
            return null
    }
}

export default DropdownButton

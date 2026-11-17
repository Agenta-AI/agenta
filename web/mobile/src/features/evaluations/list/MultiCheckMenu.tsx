import {
    Button,
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDownIcon} from "@phosphor-icons/react"

import type {FilterOption} from "./useRunFilterOptions"

/** A multi select as a checkbox menu. An empty selection means "any". */
export const MultiCheckMenu = ({
    label,
    placeholder,
    options,
    value,
    onChange,
    disabled,
}: {
    label: string
    placeholder: string
    options: readonly FilterOption[]
    value: readonly string[]
    onChange: (next: string[]) => void
    disabled?: boolean
}) => {
    const picked = options.filter((option) => value.includes(option.value))
    const summary =
        value.length === 0
            ? placeholder
            : picked.length === 1 && value.length === 1
              ? picked[0].label
              : `${value.length} selected`
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild disabled={disabled}>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={label}
                        className="w-full min-w-0 justify-between"
                    >
                        <span
                            className={`truncate ${value.length === 0 ? "text-muted-foreground" : ""}`}
                        >
                            {summary}
                        </span>
                        <CaretDownIcon aria-hidden size={12} className="shrink-0" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="max-h-[280px] min-w-[200px] overflow-y-auto"
                >
                    {options.length === 0 ? (
                        <p className="m-0 px-2 py-1.5 text-sm text-muted-foreground">No options</p>
                    ) : (
                        options.map((option) => (
                            <DropdownMenuCheckboxItem
                                key={option.value}
                                checked={value.includes(option.value)}
                                // Keep the menu open so several can be picked in one go.
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(checked) =>
                                    onChange(
                                        checked
                                            ? [...value, option.value]
                                            : value.filter((entry) => entry !== option.value),
                                    )
                                }
                            >
                                {option.label}
                            </DropdownMenuCheckboxItem>
                        ))
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

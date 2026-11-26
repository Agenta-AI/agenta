import {
    Button,
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"

/**
 * Picks any number of the listed values. Unlike the old tags select it takes no free text, so a
 * stored value is always one the evaluator schema allows. Emptying the selection sets `null`.
 */
export const AnnotationMultiSelect = ({
    id,
    options,
    value,
    onChange,
}: {
    id?: string
    options: string[]
    value: string[]
    onChange: (value: string[] | null) => void
}) => {
    const toggle = (option: string, checked: boolean) => {
        const next = checked ? [...value, option] : value.filter((item) => item !== option)
        // Keep the schema's order, whatever order the reader clicked in.
        const ordered = options.filter((item) => next.includes(item))
        onChange(ordered.length > 0 ? ordered : null)
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-8 w-full justify-between gap-2 py-1 font-normal"
                >
                    {value.length > 0 ? (
                        <span className="flex min-w-0 flex-wrap gap-1">
                            {value.map((item) => (
                                <span
                                    key={item}
                                    className="rounded-control-sm bg-chip px-1.5 text-xs leading-5 text-foreground"
                                >
                                    {item}
                                </span>
                            ))}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">Select options</span>
                    )}
                    <CaretDown aria-hidden size={12} className="shrink-0 text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
            >
                {options.map((option) => (
                    <DropdownMenuCheckboxItem
                        key={option}
                        checked={value.includes(option)}
                        onCheckedChange={(checked) => toggle(option, checked === true)}
                        onSelect={(event) => event.preventDefault()}
                    >
                        {option}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

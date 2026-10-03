import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDownIcon} from "@phosphor-icons/react"

import {SORT_LABELS, type MarketplaceSort} from "./marketplaceView"

/** The results' order, from `lg`; below it the sort rides in the filter menu. */
export const TemplateSortMenu = ({
    value,
    onChange,
}: {
    value: MarketplaceSort
    onChange: (value: MarketplaceSort) => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
                <span className="text-muted-foreground">Sort</span>
                {SORT_LABELS[value]}
                <CaretDownIcon data-icon="inline-end" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[var(--radix-dropdown-menu-trigger-width)]">
            <DropdownMenuRadioGroup
                value={value}
                onValueChange={(next) => onChange(next as MarketplaceSort)}
            >
                {(Object.keys(SORT_LABELS) as MarketplaceSort[]).map((key) => (
                    <DropdownMenuRadioItem key={key} value={key}>
                        {SORT_LABELS[key]}
                    </DropdownMenuRadioItem>
                ))}
            </DropdownMenuRadioGroup>
        </DropdownMenuContent>
    </DropdownMenu>
)

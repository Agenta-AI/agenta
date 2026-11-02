import {useId} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {
    Button,
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
    Switch,
} from "@agenta/ui/ui"
import {DotsThree} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

const SwitchRow = ({
    label,
    checked,
    onChange,
}: {
    label: string
    checked: boolean
    onChange: (checked: boolean) => void
}) => {
    const id = useId()
    return (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
            <label
                htmlFor={id}
                className="cursor-pointer select-none text-xs text-muted-foreground"
            >
                {label}
            </label>
        </span>
    )
}

/**
 * "Hide marked complete" and "Auto next". On a phone they move into a More menu so the footer
 * keeps room for the buttons.
 */
export const FocusSwitches = ({compact}: {compact: boolean}) => {
    const hideCompleted = useAtomValue(annotationSessionController.selectors.hideCompletedInFocus())
    const autoNext = useAtomValue(annotationSessionController.selectors.focusAutoNext())
    const setHideCompleted = useSetAtom(annotationSessionController.actions.setHideCompletedInFocus)
    const setAutoNext = useSetAtom(annotationSessionController.actions.setFocusAutoNext)

    if (compact) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="More">
                        <DotsThree aria-hidden size={16} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuCheckboxItem
                        checked={hideCompleted}
                        onCheckedChange={(checked) => setHideCompleted(checked === true)}
                    >
                        Hide marked complete
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                        checked={autoNext}
                        onCheckedChange={(checked) => setAutoNext(checked === true)}
                    >
                        Auto next
                    </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
            </DropdownMenu>
        )
    }
    return (
        <div className="flex items-center gap-4">
            <SwitchRow
                label="Hide marked complete"
                checked={hideCompleted}
                onChange={setHideCompleted}
            />
            <SwitchRow label="Auto next" checked={autoNext} onChange={setAutoNext} />
        </div>
    )
}

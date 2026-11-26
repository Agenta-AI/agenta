import {useDebounceInput} from "@agenta/shared/hooks"
import {Input} from "@agenta/ui/ui"

/** The search box over a step table. The box follows each key; `onChange` waits for a pause. */
export const StepSearch = ({
    value,
    label,
    disabled,
    onChange,
}: {
    value: string
    /** What the search covers, for a screen reader: "Search revisions". */
    label: string
    disabled?: boolean
    onChange: (value: string) => void
}) => {
    const [typed, setTyped] = useDebounceInput<string>(value, onChange, 300, "")
    return (
        <Input
            value={typed}
            placeholder="Search"
            aria-label={label}
            disabled={disabled}
            onChange={(event) => setTyped(event.target.value)}
            className="w-full sm:w-[260px]"
        />
    )
}

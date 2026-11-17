import {useRef} from "react"

import {Button, Field, Input} from "@agenta/ui/ui"
import {Plus, Trash} from "@phosphor-icons/react"

/** The options of a choice feedback; Enter adds the next option. */
export const FeedbackOptionsField = ({
    options,
    error,
    optionErrors,
    disabled,
    onChange,
}: {
    options: string[]
    /** "Add at least one option", under the list. */
    error?: string
    /** Per option, by index. */
    optionErrors: Record<number, string>
    disabled: boolean
    onChange: (options: string[]) => void
}) => {
    const listRef = useRef<HTMLDivElement>(null)
    const focusOption = (index: number) =>
        requestAnimationFrame(() =>
            listRef.current?.querySelectorAll<HTMLInputElement>("input")[index]?.focus(),
        )
    const add = (focus: boolean) => {
        onChange([...options, ""])
        if (focus) focusOption(options.length)
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Options</span>
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => add(true)}
                >
                    <Plus aria-hidden />
                    Add option
                </Button>
            </div>
            <div ref={listRef} className="flex flex-col gap-2">
                {options.map((option, index) => (
                    <Field key={index} error={optionErrors[index]}>
                        <div className="flex items-center gap-1">
                            <Input
                                value={option}
                                placeholder="Option name"
                                aria-label={`Option ${index + 1}`}
                                disabled={disabled}
                                onChange={(event) =>
                                    onChange(
                                        options.map((value, at) =>
                                            at === index ? event.target.value : value,
                                        ),
                                    )
                                }
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        event.preventDefault()
                                        if (index === options.length - 1) add(true)
                                        else focusOption(index + 1)
                                    } else if (event.key === "ArrowDown") {
                                        event.preventDefault()
                                        focusOption(index + 1)
                                    } else if (event.key === "ArrowUp") {
                                        event.preventDefault()
                                        focusOption(index - 1)
                                    }
                                }}
                            />
                            <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove option ${index + 1}`}
                                disabled={disabled || options.length === 1}
                                onClick={() => onChange(options.filter((_, at) => at !== index))}
                            >
                                <Trash aria-hidden />
                            </Button>
                        </div>
                    </Field>
                ))}
            </div>
            {error ? <p className="m-0 text-[13px] text-colorError">{error}</p> : null}
        </div>
    )
}

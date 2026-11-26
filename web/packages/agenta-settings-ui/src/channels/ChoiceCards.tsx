import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import channelsConnectCatalog from "@agenta/i18n/catalogs/channels.connect"
import {SelectMarkCheck} from "@agenta/ui/list-table"
import {RadioGroup, RadioGroupItem} from "@agenta/ui/ui"

export interface ChoiceCardOption<T extends string> {
    value: T
    title: string
    desc: string
    /** The Mark's icon; the Mark turns into the check when the choice is picked. */
    icon: ReactNode
    recommended?: boolean
    disabled?: boolean
}

/**
 * One choice of a few, as the Skills rows pick: each row leads with a Mark that turns into the
 * check when picked. The radio is invisible over the Mark, so the arrow keys still move the choice.
 */
export const ChoiceCards = <T extends string>({
    options,
    value,
    onChange,
    testId,
}: {
    options: ChoiceCardOption<T>[]
    value: T
    onChange: (value: T) => void
    testId?: string
}) => {
    const t = useT(channelsConnectCatalog)
    return (
        <RadioGroup
            value={value}
            onValueChange={(next) => onChange(next as T)}
            className="gap-2"
            data-testid={testId}
        >
            {options.map((option) => {
                const selected = option.value === value
                return (
                    <label
                        key={option.value}
                        className={`-mx-3 box-border flex min-h-row-double items-center gap-3 rounded-md px-3 py-1.5 transition-colors duration-[var(--duration-fast)] ease-out motion-reduce:transition-none ${
                            option.disabled
                                ? "cursor-default opacity-60"
                                : selected
                                  ? "cursor-pointer"
                                  : "cursor-pointer hover:bg-accent"
                        } ${selected ? "bg-selected" : ""}`}
                    >
                        <span className="relative inline-flex shrink-0">
                            <span className="flex size-8 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">
                                {option.icon}
                            </span>
                            <RadioGroupItem
                                value={option.value}
                                disabled={option.disabled}
                                aria-label={option.title}
                                className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer appearance-none rounded-md border-0 bg-transparent opacity-0"
                                data-testid={testId ? `${testId}-${option.value}` : undefined}
                            />
                            <SelectMarkCheck checked={selected} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="flex items-center gap-2 text-label font-medium text-foreground">
                                {option.title}
                                {option.recommended ? (
                                    <span className="rounded-sm bg-success/10 px-1.5 text-caption font-normal leading-5 text-success">
                                        {t("channels.connect.recommended")}
                                    </span>
                                ) : null}
                            </span>
                            <span className="text-label text-muted-foreground">{option.desc}</span>
                        </span>
                    </label>
                )
            })}
        </RadioGroup>
    )
}

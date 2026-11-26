import {useT} from "@agenta/i18n"
import channelsConnectCatalog from "@agenta/i18n/catalogs/channels.connect"
import {RadioGroup, RadioGroupItem} from "@agenta/ui/ui"

export interface ChoiceCardOption<T extends string> {
    value: T
    title: string
    desc: string
    recommended?: boolean
    disabled?: boolean
}

/**
 * One choice of a few, each a title and a note: the choices sit on one secondary track and the
 * selected one is the background fill, as in the kit Segmented (SURF-01: tone, not borders).
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
            className="gap-0.5 rounded-lg bg-secondary p-0.5"
            data-testid={testId}
        >
            {options.map((option) => {
                const selected = option.value === value
                return (
                    <label
                        key={option.value}
                        className={`flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-reduce:transition-none ${
                            option.disabled
                                ? "cursor-default opacity-70"
                                : selected
                                  ? "cursor-pointer"
                                  : "cursor-pointer hover:bg-accent"
                        } ${selected ? "bg-background" : "bg-transparent"}`}
                    >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span
                                className={`flex items-center gap-2 text-label font-medium transition-colors duration-[var(--duration-fast)] ${
                                    selected ? "text-foreground" : "text-muted-foreground"
                                }`}
                            >
                                {option.title}
                                {option.recommended ? (
                                    <span className="rounded-sm bg-success/10 px-1.5 text-caption font-normal leading-5 text-success">
                                        {t("channels.connect.recommended")}
                                    </span>
                                ) : null}
                            </span>
                            <span className="text-label text-muted-foreground">{option.desc}</span>
                        </span>
                        <RadioGroupItem
                            value={option.value}
                            disabled={option.disabled}
                            data-testid={testId ? `${testId}-${option.value}` : undefined}
                        />
                    </label>
                )
            })}
        </RadioGroup>
    )
}

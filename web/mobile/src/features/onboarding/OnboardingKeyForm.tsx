import {createElement, useEffect, useRef, useState, type FormEvent} from "react"

import {
    KEY_PROVIDERS,
    keyPlaceholderFor,
    providerIconFor,
    useSaveProviderKey,
} from "@agenta/entity-ui/secretProvider"
import {
    Button,
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    Input,
    LoadingButton,
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@agenta/ui/ui"
import {CaretUpDown} from "@phosphor-icons/react"

import {ONBOARDING_COPY} from "./onboardingCopy"

const copy = ONBOARDING_COPY.model

/** Shorter than any provider's real key; the provider still judges the rest. */
const MIN_KEY_LENGTH = 8

type Phase = "editing" | "invalid" | "saving" | "failed"

/** Plain substring search; cmdk's fuzzy score lets "gro" match Together AI. */
const matchProvider = (value: string, search: string, keywords: string[] = []) =>
    [value, ...keywords].some((text) => text.toLowerCase().includes(search.trim().toLowerCase()))
        ? 1
        : 0

export interface SavedKey {
    provider: string
    last4: string
    connectionId: string | null
}

const providerMark = (kind: string) => (
    <span className="bg-background ring-border flex size-5 shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset">
        {createElement(providerIconFor(kind), {className: "size-[15px]"})}
    </span>
)

/** The API-key row's open state: pick a provider, paste its key, save it to the vault. */
export const OnboardingKeyForm = ({
    onSaved,
    onMoreProviders,
}: {
    onSaved: (saved: SavedKey) => void
    /** Opens the full providers drawer, for the kinds that need more than a key. */
    onMoreProviders: () => void
}) => {
    const save = useSaveProviderKey()
    const [kind, setKind] = useState(KEY_PROVIDERS[0]?.kind ?? "")
    const [key, setKey] = useState("")
    const [phase, setPhase] = useState<Phase>("editing")
    const [pickerOpen, setPickerOpen] = useState(false)
    const keyRef = useRef<HTMLInputElement>(null)
    const pickedRef = useRef(false)
    const provider = KEY_PROVIDERS.find((entry) => entry.kind === kind) ?? KEY_PROVIDERS[0]

    useEffect(() => keyRef.current?.focus(), [])

    const pick = (next: string) => {
        pickedRef.current = true
        setKind(next)
        setPhase("editing")
        setPickerOpen(false)
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (phase === "saving" || !provider) return
        const apiKey = key.trim()
        if (apiKey.length < MIN_KEY_LENGTH) {
            setPhase("invalid")
            keyRef.current?.focus()
            return
        }
        setPhase("saving")
        try {
            const connectionId = await save(provider.kind, apiKey)
            onSaved({provider: provider.title, last4: apiKey.slice(-4), connectionId})
        } catch {
            setPhase("failed")
        }
    }

    if (!provider) return null
    const error =
        phase === "invalid" ? copy.keyInvalid : phase === "failed" ? copy.keySaveFailed : null

    return (
        <form onSubmit={submit} className="flex flex-col gap-2 pb-3 sm:pl-10">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-label={copy.keyProvider}
                        className="h-8 w-full justify-start gap-2 pl-1.5 pr-2 font-medium"
                    >
                        {providerMark(provider.kind)}
                        <span className="min-w-0 flex-1 truncate text-left">{provider.title}</span>
                        <span className="text-muted-foreground text-xs font-normal">
                            {copy.keyProviders(KEY_PROVIDERS.length)}
                        </span>
                        <CaretUpDown size={12} className="text-muted-foreground" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-1"
                    onCloseAutoFocus={(event) => {
                        if (!pickedRef.current) return
                        pickedRef.current = false
                        event.preventDefault()
                        keyRef.current?.focus()
                    }}
                >
                    <Command filter={matchProvider}>
                        <CommandInput placeholder={copy.keySearch} />
                        <CommandList className="max-h-[212px]">
                            <CommandEmpty>{copy.keyNoMatch}</CommandEmpty>
                            <CommandGroup>
                                {KEY_PROVIDERS.map((entry) => (
                                    <CommandItem
                                        key={entry.kind}
                                        value={entry.title}
                                        keywords={[entry.kind]}
                                        data-checked={entry.kind === provider.kind}
                                        onSelect={() => pick(entry.kind)}
                                    >
                                        {providerMark(entry.kind)}
                                        {entry.title}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                            <CommandSeparator />
                            <CommandGroup forceMount>
                                <CommandItem
                                    forceMount
                                    value={copy.keyMore}
                                    onSelect={() => {
                                        setPickerOpen(false)
                                        onMoreProviders()
                                    }}
                                    className="text-muted-foreground"
                                >
                                    {copy.keyMore}
                                </CommandItem>
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <div className="flex gap-1.5 max-sm:flex-col">
                <Input
                    ref={keyRef}
                    type="password"
                    aria-label={copy.keyLabel}
                    aria-invalid={phase === "invalid" || undefined}
                    placeholder={keyPlaceholderFor(provider.kind, provider.title)}
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    className="flex-1 font-mono"
                    value={key}
                    onChange={(event) => {
                        setKey(event.target.value)
                        if (phase !== "saving") setPhase("editing")
                    }}
                />
                <LoadingButton
                    type="submit"
                    loading={phase === "saving"}
                    className="max-sm:h-11 max-sm:w-full"
                >
                    {copy.save}
                </LoadingButton>
            </div>
            {error ? (
                <span role="alert" className="text-destructive text-xs leading-4">
                    {error}
                </span>
            ) : null}
        </form>
    )
}

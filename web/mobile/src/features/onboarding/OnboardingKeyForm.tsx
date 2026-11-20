import {createElement, useCallback, useEffect, useRef, useState, type FormEvent} from "react"

import {probeRequestFor} from "@agenta/entities/secret"
import {
    keyCheckSignature,
    KEY_PROVIDERS,
    keyPlaceholderFor,
    providerIconFor,
    useKeyCheck,
    useSaveProviderKey,
} from "@agenta/entity-ui/secretProvider"
import {useT} from "@agenta/i18n"
import providerKeyFormCatalog from "@agenta/i18n/catalogs/entityUi.providerKeyForm"
import keyFormCatalog from "@agenta/i18n/catalogs/onboarding.keyForm"
import {
    Button,
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    Input,
    LoadingButton,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Spinner,
} from "@agenta/ui/ui"
import {CaretUpDown} from "@phosphor-icons/react"

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

/**
 * The API-key row's open state: pick a provider, paste its key, save it to the vault. The key is
 * checked by itself on paste and on blur, as in the provider form; a key the provider rejects is
 * not saved, and Save on an unchecked key checks it first.
 */
export const OnboardingKeyForm = ({onSaved}: {onSaved: (saved: SavedKey) => void}) => {
    const t = useT(keyFormCatalog, providerKeyFormCatalog)
    const save = useSaveProviderKey()
    const keyCheck = useKeyCheck()
    // Save was pressed before the check answered: it saves when the key passes.
    const saveWhenChecked = useRef(false)
    const [kind, setKind] = useState(KEY_PROVIDERS[0]?.kind ?? "")
    const [key, setKey] = useState("")
    const [phase, setPhase] = useState<Phase>("editing")
    const [pickerOpen, setPickerOpen] = useState(false)
    const keyRef = useRef<HTMLInputElement>(null)
    const pickedRef = useRef(false)
    // A paste landed in the key field: its change starts the check.
    const pastedRef = useRef(false)
    const provider = KEY_PROVIDERS.find((entry) => entry.kind === kind) ?? KEY_PROVIDERS[0]

    useEffect(() => keyRef.current?.focus(), [])

    const requestFor = (forKind: string, value: string) =>
        probeRequestFor(forKind, {apiKey: value.trim()})

    /** Checks the key unless it is too short or was already checked as it is. */
    const checkKey = (forKind: string, value: string, force = false) => {
        if (value.trim().length < MIN_KEY_LENGTH) return
        const request = requestFor(forKind, value)
        const {state} = keyCheck
        if (!force && state.phase !== "idle" && state.signature === keyCheckSignature(request))
            return
        keyCheck.check(request)
    }

    const pick = (next: string) => {
        pickedRef.current = true
        setKind(next)
        setPhase("editing")
        setPickerOpen(false)
        saveWhenChecked.current = false
        keyCheck.drop()
        checkKey(next, key, true)
    }

    const store = useCallback(async () => {
        if (!provider) return
        const apiKey = key.trim()
        setPhase("saving")
        try {
            const connectionId = await save(provider.kind, apiKey)
            onSaved({provider: provider.title, last4: apiKey.slice(-4), connectionId})
        } catch {
            setPhase("failed")
        }
    }, [provider, key, save, onSaved])

    const checkState = keyCheck.state
    const status = checkState.phase === "done" ? checkState.result.credential.status : null
    // A key that works, or one Agenta cannot prove, may be saved.
    const passed = status === "valid" || status === "unknown"

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (phase === "saving" || !provider) return
        if (key.trim().length < MIN_KEY_LENGTH) {
            setPhase("invalid")
            keyRef.current?.focus()
            return
        }
        if (status === "invalid") return
        // A check that could not answer does not keep a new user from saving: the second
        // press saves, as onboarding did before the check.
        if (passed || checkState.phase === "failed") return void store()
        // Not checked yet: check first, then save if the key passes.
        saveWhenChecked.current = true
        if (checkState.phase !== "checking") checkKey(provider.kind, key, true)
    }

    // A save that waited for the check goes on once the key passed.
    useEffect(() => {
        if (!saveWhenChecked.current || checkState.phase === "checking") return
        saveWhenChecked.current = false
        if (passed) void store()
    }, [checkState.phase, passed, store])

    if (!provider) return null
    const providerName = provider.title
    // The line under the key: the check that runs, or what it answered.
    const checkLine =
        checkState.phase === "checking" ? (
            <span role="status" className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Spinner size="small" />
                {t("entityUi.providerKeyForm.checking", {provider: providerName})}
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-xs"
                    onClick={() => {
                        saveWhenChecked.current = false
                        keyCheck.drop()
                    }}
                >
                    {t("entityUi.providerKeyForm.stop")}
                </Button>
            </span>
        ) : status === "invalid" ? (
            <span role="alert" className="text-destructive text-xs leading-4">
                {t("entityUi.providerKeyForm.keyRejected", {provider: providerName})}
            </span>
        ) : status === "valid" ? (
            <span role="status" className="text-success text-xs leading-4">
                {checkState.phase === "done" && checkState.result.discovery.status === "fetched"
                    ? t("entityUi.providerKeyForm.keyWorks", {
                          count: checkState.result.discovery.models?.length ?? 0,
                      })
                    : t("entityUi.providerKeyForm.keyWorksNoList")}
            </span>
        ) : status === "unknown" ? (
            <span role="status" className="text-muted-foreground text-xs leading-4">
                {t("entityUi.providerKeyForm.untested")}
            </span>
        ) : checkState.phase === "failed" ? (
            <span role="alert" className="text-destructive text-xs leading-4">
                {t("entityUi.providerKeyForm.checkFailed")}
            </span>
        ) : null
    const error =
        phase === "invalid"
            ? t("onboarding.keyForm.invalid")
            : phase === "failed"
              ? t("onboarding.keyForm.saveFailed")
              : null

    return (
        <form onSubmit={submit} className="flex flex-col gap-2 pb-3 sm:pl-10">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-label={t("onboarding.keyForm.provider")}
                        className="h-8 w-full justify-start gap-2 pl-1.5 pr-2 font-medium"
                    >
                        {providerMark(provider.kind)}
                        <span className="min-w-0 flex-1 truncate text-left">{provider.title}</span>
                        <span className="text-muted-foreground text-xs font-normal">
                            {t("onboarding.keyForm.providerCount", {total: KEY_PROVIDERS.length})}
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
                        <CommandInput placeholder={t("onboarding.keyForm.search")} />
                        <CommandList className="max-h-[212px]">
                            <CommandEmpty>{t("onboarding.keyForm.noMatch")}</CommandEmpty>
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
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            <div className="flex gap-1.5 max-sm:flex-col">
                <Input
                    ref={keyRef}
                    type="password"
                    aria-label={t("onboarding.keyForm.keyLabel")}
                    aria-invalid={phase === "invalid" || undefined}
                    placeholder={keyPlaceholderFor(provider.kind, provider.title)}
                    autoComplete="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    className="flex-1 font-mono"
                    value={key}
                    onPaste={() => {
                        pastedRef.current = true
                    }}
                    onBlur={() => checkKey(provider.kind, key)}
                    onChange={(event) => {
                        const next = event.target.value
                        setKey(next)
                        if (phase !== "saving") setPhase("editing")
                        // The last answer belonged to the previous key.
                        saveWhenChecked.current = false
                        keyCheck.drop()
                        if (pastedRef.current) checkKey(provider.kind, next, true)
                        pastedRef.current = false
                    }}
                />
                <LoadingButton
                    type="submit"
                    loading={phase === "saving"}
                    disabled={status === "invalid"}
                    className="max-sm:h-11 max-sm:w-full"
                >
                    {t("onboarding.keyForm.save")}
                </LoadingButton>
            </div>
            {error ? (
                <span role="alert" className="text-destructive text-xs leading-4">
                    {error}
                </span>
            ) : (
                checkLine
            )}
        </form>
    )
}

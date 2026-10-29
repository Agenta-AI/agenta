/**
 * The card behind a subscription row — one subscription × harness pair.
 *
 * A pair is not a connection: nothing was added, nothing is stored, and there is no credential to
 * test. So the card has no Test, no Validate, and no "enable in" list — the pair IS the harness,
 * and a login the provider ends up rejecting fails on the run itself, in the playground, where the
 * error can say something useful.
 *
 * That leaves one status line and one choice: the plan fixes which models exist, the checkboxes
 * choose which of them show in the model picker.
 *
 * Design: providers-drawer-final/README.md §6 ("Pair card").
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    subscriptionPairModels,
    subscriptionPairModelsAtom,
    type SubscriptionPair,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {Tag} from "@agenta/ui"
import {Checkbox} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:providers-drawer:subscriptions"

export interface SubscriptionPairCardSaveState {
    submit: () => void
}

export interface SubscriptionPairCardProps {
    pair: SubscriptionPair
    /** Where "How detection works" points — the same guide the setup row links to. */
    docsUrl: string
    /** Called after Done writes the selection, so the drawer can step back. */
    onDone: () => void
    /** Publishes the submit the drawer's footer fires. */
    onSaveStateChange?: (state: SubscriptionPairCardSaveState) => void
}

const SubscriptionPairCard = ({
    pair,
    docsUrl,
    onDone,
    onSaveStateChange,
}: SubscriptionPairCardProps) => {
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const savedByPair = useAtomValue(subscriptionPairModelsAtom)
    const saveSelection = useSetAtom(subscriptionPairModelsAtom)

    const {models, defaults} = useMemo(
        () => subscriptionPairModels(capabilities, pair),
        [capabilities, pair],
    )

    /**
     * What an untouched pair offers: the plan's recommended set when it has one, otherwise
     * everything the pair runs.
     *
     * The `else everything` half matters — a harness that publishes models but no `default_models`
     * would otherwise pre-check nothing, and a working subscription would contribute no rows to the
     * picker at all. Same rule a connection follows (`connectionModelIds`, `connectionModelCount`),
     * so the drawer and the picker cannot disagree about a pair nobody has edited.
     */
    const preselected = useMemo(() => (defaults.length ? defaults : models), [defaults, models])

    // `null` means "not chosen yet". A saved EMPTY list is a choice, not an absence, so `??` keeps
    // it: the user cleared the list and the picker shows nothing for this pair.
    const [checked, setChecked] = useState<string[] | null>(savedByPair[pair.key] ?? null)
    const effective = checked ?? preselected

    // Recommended first, then the rest in the order the harness published them.
    const ordered = useMemo(
        () =>
            [...models].sort((a, b) => Number(defaults.includes(b)) - Number(defaults.includes(a))),
        [models, defaults],
    )

    // The drawer draws the footer, so the card hands it a stable submit. The ref keeps `submit`
    // identical across renders — the drawer never re-renders for a checkbox tick.
    const saveRef = useRef(() => {
        saveSelection({pairKey: pair.key, models: effective})
        onDone()
    })
    saveRef.current = () => {
        saveSelection({pairKey: pair.key, models: effective})
        onDone()
    }
    const submit = useCallback(() => saveRef.current(), [])

    useEffect(() => {
        onSaveStateChange?.({submit})
    }, [onSaveStateChange, submit])

    return (
        <div className="flex min-h-full flex-1 flex-col gap-4 text-xs">
            <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5 text-colorSuccess">
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-colorSuccess" />
                    Detected — {pair.name}
                </span>
                <a
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-field-sm text-btn-link hover:text-btn-link-hover"
                >
                    How detection works
                </a>
            </div>

            <section className="flex min-h-0 flex-1 flex-col gap-2">
                <span className="font-medium text-colorText">
                    Active models{" "}
                    <span className="font-normal text-colorTextTertiary">— fixed by the plan</span>
                </span>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-solid border-colorBorderSecondary">
                    {ordered.length === 0 ? (
                        <p className="m-0 px-3 py-3 text-colorTextSecondary">
                            This harness publishes no models for {pair.name} yet.
                        </p>
                    ) : (
                        ordered.map((id, index) => (
                            <label
                                key={id}
                                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-colorFillQuaternary ${
                                    index === ordered.length - 1
                                        ? ""
                                        : "border-0 border-b border-solid border-colorSplit"
                                }`}
                            >
                                <Checkbox
                                    checked={effective.includes(id)}
                                    onCheckedChange={(next) =>
                                        setChecked(
                                            next === true
                                                ? [...effective.filter((m) => m !== id), id]
                                                : effective.filter((m) => m !== id),
                                        )
                                    }
                                />
                                <span className="min-w-0 flex-1 truncate font-mono text-field-sm text-colorText">
                                    {id}
                                </span>
                                {defaults.includes(id) ? (
                                    <Tag size="small" tone="default" label="recommended" />
                                ) : null}
                            </label>
                        ))
                    )}
                </div>

                <span className="text-[11px] text-colorTextTertiary">
                    The plan defines the list — you only choose what shows in the picker.
                </span>
            </section>
        </div>
    )
}

export default SubscriptionPairCard

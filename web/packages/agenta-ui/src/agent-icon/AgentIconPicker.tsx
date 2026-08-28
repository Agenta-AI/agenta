import {useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent} from "react"

import {MagnifyingGlassIcon} from "@phosphor-icons/react"
import {useVirtualizer} from "@tanstack/react-virtual"

import {SearchInput} from "../components/ui/input-composed"
import {Spinner} from "../components/ui/spinner"
import {cn} from "../components/ui/utils"

import {
    AGENT_ICON_CHIP_CLASS,
    AgentIcon,
    agentIconChipStyle,
    type AgentIconSelection,
} from "./AgentIcon"
import {loadAgentIconCatalog, type PhosphorCatalogEntry} from "./catalog"
import {
    AGENT_ICON_COLORS,
    AGENT_ICON_CONIC,
    DEFAULT_AGENT_ICON,
    clamp,
    hexToHsv,
    hsvToHex,
    isHexColor,
    normalizeHex,
} from "./colors"

export interface AgentIconPickerProps {
    value: AgentIconSelection | null
    /** Fires on every pick — the picker has no save button. Colour drags commit on release.
     * `null` clears the choice, putting the agent back on its surface's default chrome. */
    onChange: (next: AgentIconSelection | null) => void
}

const COLUMNS = 8
const CELL = 32
const GAP = 2
const GRID_H = 184
/** The swatch row and the search field that sit between the header and the grid. The loading and
 * error states derive their height from this so the panel never resizes under the pointer. */
const CONTROLS_H = 72

const SWATCH_BASE = "size-5 shrink-0 cursor-pointer rounded-full p-0"

/** Flat colours need a hairline to sit off the panel, and a black one disappears against a dark
 * popover, so it flips with the theme. The conic buttons carry their own edge and take no border. */
const SWATCH_BUTTON = `${SWATCH_BASE} border border-solid border-black/10 dark:border-white/20`

/** Preflight is off, so a button keeps the UA's outset border unless it is explicitly cleared. */
const SWATCH_PLAIN = `${SWATCH_BASE} border-0`

/**
 * The selected ring. `outline-offset` leaves a genuinely transparent gap — an inset box-shadow can
 * only fake one by painting the panel colour, which then breaks anywhere the panel isn't that colour.
 */
const selectedRing = (color: string): CSSProperties => ({
    outline: `2px solid ${color}`,
    outlineOffset: 2,
})

/**
 * Track a pointer across an element, reporting position as 0..1 fractions. The rect is read once at
 * pointerdown — the surface can't move mid-drag, and reading it per move forces a reflow against
 * the re-render each move causes.
 *
 * Returns a teardown so the caller can drop a drag still in flight when it unmounts; without it a
 * popover closed mid-drag still commits on the eventual pointerup.
 */
const trackDrag = (
    event: PointerEvent<HTMLDivElement>,
    onMove: (x: number, y: number) => void,
    onCommit: () => void,
): (() => void) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const track = (e: {clientX: number; clientY: number}) =>
        onMove(
            clamp((e.clientX - rect.left) / rect.width, 0, 1),
            clamp((e.clientY - rect.top) / rect.height, 0, 1),
        )

    const detach = () => {
        window.removeEventListener("pointermove", track)
        window.removeEventListener("pointerup", stop)
    }
    const stop = () => {
        detach()
        onCommit()
    }

    track(event)
    window.addEventListener("pointermove", track)
    window.addEventListener("pointerup", stop)
    return detach
}

const ColorSwatchRow = ({
    selected,
    onPick,
    onCustom,
}: {
    /** The stored colour, or null when the agent has no choice yet — an uncustomised agent shows no
     * ring, so clicking the first swatch is a real change rather than a no-op that shifts dark mode. */
    selected: string | null
    onPick: (hex: string) => void
    onCustom: () => void
}) => (
    // `justify-between` so the row spans the same width as the search field below it — at a fixed
    // gap the swatches pack left and stop ~13px short of it.
    <div className="flex flex-nowrap items-center justify-between gap-1.5 px-3 pb-2.5">
        {AGENT_ICON_COLORS.map(([solid]) => (
            <button
                key={solid}
                type="button"
                aria-label={solid}
                onClick={() => onPick(solid)}
                className={SWATCH_BUTTON}
                style={{
                    background: solid,
                    ...(solid.toLowerCase() === selected?.toLowerCase()
                        ? selectedRing(solid)
                        : null),
                }}
            />
        ))}
        <span className="mx-px h-3.5 w-px shrink-0 bg-colorBorderSecondary" />
        <button
            type="button"
            onClick={onCustom}
            title="Custom colour"
            aria-label="Custom colour"
            className={SWATCH_PLAIN}
            style={{background: AGENT_ICON_CONIC}}
        />
    </div>
)

/**
 * Hue/saturation/value is the state here and the hex is its output — NOT the other way round.
 * Deriving HSV from the hex each render loses the hue at both achromatic edges: any drag to white
 * or black collapses to `h: 0`, and dragging back would give reds instead of the colour the user
 * came from. The exact seed hex is kept alongside so opening the panel cannot round-trip it by a
 * digit.
 */
const CustomColorArea = ({
    seed,
    onPreview,
    onCommitDrag,
    onCommitColor,
    onBack,
}: {
    seed: string
    onPreview: (hex: string) => void
    onCommitDrag: () => void
    onCommitColor: (hex: string) => void
    onBack: () => void
}) => {
    const [{hsv, hex}, setColor] = useState(() => ({
        hsv: hexToHsv(seed),
        hex: seed.toUpperCase(),
    }))
    /** Only set while the user is mid-edit — an override, not a mirror of `hex`. */
    const [draft, setDraft] = useState<string | null>(null)

    /** A drag still in flight when the popover closes must not commit. */
    const detachRef = useRef<(() => void) | null>(null)
    useEffect(() => () => detachRef.current?.(), [])

    const startDrag = (
        event: PointerEvent<HTMLDivElement>,
        toHsv: (x: number, y: number) => {h: number; s: number; v: number},
    ) => {
        detachRef.current = trackDrag(
            event,
            (x, y) => {
                const next = toHsv(x, y)
                const nextHex = hsvToHex(next.h, next.s, next.v).toUpperCase()
                setColor({hsv: next, hex: nextHex})
                onPreview(nextHex)
            },
            () => {
                detachRef.current = null
                onCommitDrag()
            },
        )
    }

    const onHexInput = (next: string) => {
        setDraft(next)
        if (!isHexColor(next)) return
        const normalized = normalizeHex(next).toUpperCase()
        setColor({hsv: hexToHsv(normalized), hex: normalized})
        onCommitColor(normalized)
    }

    const hueCss = `hsl(${Math.round(hsv.h)},100%,50%)`

    return (
        <>
            <div className="flex items-center gap-2 px-3 pb-2.5">
                <span className="text-[11px] uppercase tracking-[0.04em] text-colorTextTertiary">
                    Hex
                </span>
                <input
                    value={draft ?? hex}
                    onChange={(e) => onHexInput(e.target.value)}
                    onBlur={() => setDraft(null)}
                    spellCheck={false}
                    aria-label="Hex colour"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 py-1 font-mono text-[12px] text-colorText outline-none"
                />
                <button
                    type="button"
                    onClick={onBack}
                    title="Back to palette"
                    aria-label="Back to palette"
                    className={SWATCH_PLAIN}
                    // Brand accent, not currentColor: the text colour reads as a stray white ring
                    // in dark mode and says nothing about the control being active.
                    style={{
                        background: AGENT_ICON_CONIC,
                        ...selectedRing("var(--ag-colorPrimary)"),
                    }}
                />
            </div>
            <div className="flex items-stretch gap-2.5 px-3 pb-3">
                <div
                    onPointerDown={(e) => startDrag(e, (x, y) => ({h: hsv.h, s: x, v: 1 - y}))}
                    className="relative h-[104px] min-w-0 flex-1 cursor-crosshair rounded-lg"
                    style={{
                        backgroundImage: `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,${hueCss})`,
                    }}
                >
                    <span
                        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]"
                        style={{left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`}}
                    />
                </div>
                <div
                    onPointerDown={(e) =>
                        // A grey has no hue to drag along, so give the strip something to move
                        // through rather than emitting greys all the way down.
                        startDrag(e, (_x, y) => ({
                            h: y * 360,
                            s: hsv.s || 0.8,
                            v: hsv.v || 0.6,
                        }))
                    }
                    className="relative w-2.5 shrink-0 cursor-pointer rounded-full"
                    style={{
                        background: "linear-gradient(to bottom,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
                    }}
                >
                    {/* A flat bar, not a filled dot: it overhangs the strip on both sides, so the
                        hue it points at stays visible instead of being covered by the handle. */}
                    <span
                        className="absolute -left-1 -right-1 h-1.5 -translate-y-1/2 rounded-sm border border-solid border-black/20 bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)]"
                        style={{top: `${(hsv.h / 360) * 100}%`}}
                    />
                </div>
            </div>
        </>
    )
}

const IconGrid = ({
    entries,
    selectedName,
    chipStyle,
    onPick,
}: {
    entries: PhosphorCatalogEntry[]
    selectedName: string
    chipStyle: CSSProperties
    onPick: (entry: PhosphorCatalogEntry) => void
}) => {
    const scrollRef = useRef<HTMLDivElement>(null)
    const virtualizer = useVirtualizer({
        count: Math.ceil(entries.length / COLUMNS),
        getScrollElement: () => scrollRef.current,
        estimateSize: () => CELL + GAP,
        overscan: 4,
    })

    return (
        // Fixed, not max: a two-result search would otherwise collapse the panel and move
        // everything under the pointer.
        <div ref={scrollRef} className="overflow-y-auto px-2 pb-2" style={{height: GRID_H}}>
            <div className="relative w-full" style={{height: virtualizer.getTotalSize()}}>
                {virtualizer.getVirtualItems().map((row) => (
                    <div
                        key={row.key}
                        className="absolute inset-x-0 top-0 grid grid-cols-8 gap-0.5"
                        style={{height: CELL, transform: `translateY(${row.start}px)`}}
                    >
                        {entries
                            .slice(row.index * COLUMNS, (row.index + 1) * COLUMNS)
                            .map((entry) => {
                                const selected = entry.name === selectedName
                                return (
                                    <button
                                        key={entry.name}
                                        type="button"
                                        title={entry.name.replace(/-/g, " ")}
                                        onClick={() => onPick(entry)}
                                        className={cn(
                                            "flex h-8 cursor-pointer items-center justify-center rounded-md border-0 p-0",
                                            selected
                                                ? AGENT_ICON_CHIP_CLASS
                                                : "bg-transparent text-colorTextSecondary hover:bg-black/5 dark:hover:bg-white/10",
                                        )}
                                        style={selected ? chipStyle : undefined}
                                    >
                                        <AgentIcon path={entry.path} size={17} />
                                    </button>
                                )
                            })}
                    </div>
                ))}
            </div>
        </div>
    )
}

export const AgentIconPicker = ({value, onChange}: AgentIconPickerProps) => {
    const [catalog, setCatalog] = useState<PhosphorCatalogEntry[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const [query, setQuery] = useState("")
    const [search, setSearch] = useState("")
    const [custom, setCustom] = useState(false)
    /** A colour drag previews here and commits on release, so one drag is one localStorage write.
     * The ref carries the live value into the pointerup handler, which closes over the render the
     * drag STARTED in and would otherwise still see `null`. */
    const [preview, setPreview] = useState<string | null>(null)
    const previewRef = useRef<string | null>(null)

    const color = preview ?? value?.color ?? DEFAULT_AGENT_ICON.color
    const iconName = value?.icon ?? DEFAULT_AGENT_ICON.icon

    useEffect(() => {
        let alive = true
        setFailed(false)
        loadAgentIconCatalog().then(
            (entries) => {
                if (alive) setCatalog(entries)
            },
            () => {
                if (alive) setFailed(true)
            },
        )
        return () => {
            alive = false
        }
    }, [attempt])

    useEffect(() => {
        const id = setTimeout(() => setSearch(query.trim().toLowerCase()), 150)
        return () => clearTimeout(id)
    }, [query])

    /** One string per icon, built once, so a keystroke is one `includes` per icon and no allocation. */
    const haystacks = useMemo(
        () =>
            catalog?.map(
                (entry) =>
                    `${entry.name.replace(/-/g, " ")} ${entry.tags.join(" ")} ${entry.categories.join(" ")}`,
            ) ?? [],
        [catalog],
    )

    const filtered = useMemo(() => {
        if (!catalog) return []
        if (!search) return catalog
        return catalog.filter((_entry, i) => haystacks[i].includes(search))
    }, [catalog, haystacks, search])

    /** The preview chip needs a path before the user has picked anything. */
    const currentPath = value?.path ?? catalog?.find((entry) => entry.name === iconName)?.path ?? ""

    const commit = (next: Partial<AgentIconSelection>) =>
        onChange({icon: iconName, path: currentPath, color, ...next})

    const previewColor = (hex: string) => {
        previewRef.current = hex
        setPreview(hex)
    }

    const commitPreview = () => {
        const hex = previewRef.current
        previewRef.current = null
        setPreview(null)
        if (hex) commit({color: hex})
    }

    const chipStyle = agentIconChipStyle(color)

    return (
        <div className="w-[300px]">
            <div className="flex items-center gap-2.5 p-3 pb-2.5">
                <span
                    className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        AGENT_ICON_CHIP_CLASS,
                    )}
                    style={chipStyle}
                >
                    {currentPath ? <AgentIcon path={currentPath} size={18} /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="text-[13px] font-semibold text-colorText">Agent icon</span>
                    <span className="text-[11px] text-colorTextTertiary">Saves as you pick</span>
                </span>
                {value ? (
                    <button
                        type="button"
                        onClick={() => {
                            setCustom(false)
                            onChange(null)
                        }}
                        className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[12px] text-colorTextTertiary hover:text-colorText"
                    >
                        Reset
                    </button>
                ) : null}
            </div>

            {/* Everything below the header needs the catalog: a colour picked before it lands would
                be stored against an empty glyph path. */}
            {failed ? (
                <div
                    className="flex flex-col items-center justify-center gap-2 px-6 text-center"
                    style={{height: GRID_H + CONTROLS_H}}
                >
                    <span className="text-[13px] font-medium text-colorText">
                        Could not load icons
                    </span>
                    <button
                        type="button"
                        onClick={() => setAttempt((n) => n + 1)}
                        className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-colorPrimary"
                    >
                        Try again
                    </button>
                </div>
            ) : !catalog ? (
                <div
                    className="flex items-center justify-center"
                    style={{height: GRID_H + CONTROLS_H}}
                >
                    <Spinner />
                </div>
            ) : (
                <>
                    {custom ? (
                        <CustomColorArea
                            seed={color}
                            onPreview={previewColor}
                            onCommitDrag={commitPreview}
                            onCommitColor={(hex) => commit({color: hex})}
                            onBack={() => setCustom(false)}
                        />
                    ) : (
                        <ColorSwatchRow
                            selected={preview ?? value?.color ?? null}
                            onPick={(hex) => commit({color: hex})}
                            onCustom={() => setCustom(true)}
                        />
                    )}

                    <div className="px-3 pb-2">
                        <SearchInput
                            value={query}
                            onValueChange={setQuery}
                            placeholder="Search icons"
                            aria-label="Search icons"
                        />
                    </div>

                    {filtered.length === 0 ? (
                        <div
                            className="flex flex-col items-center justify-center gap-1 px-6 text-center"
                            style={{height: GRID_H}}
                        >
                            <MagnifyingGlassIcon size={20} className="text-colorTextTertiary" />
                            <span className="text-[13px] font-medium text-colorText">
                                No icons found
                            </span>
                            <span className="max-w-full truncate text-[12px] text-colorTextTertiary">
                                Nothing matches “{search}”
                            </span>
                        </div>
                    ) : (
                        <IconGrid
                            entries={filtered}
                            selectedName={value ? iconName : ""}
                            chipStyle={chipStyle}
                            onPick={(entry) => commit({icon: entry.name, path: entry.path})}
                        />
                    )}
                </>
            )}
        </div>
    )
}

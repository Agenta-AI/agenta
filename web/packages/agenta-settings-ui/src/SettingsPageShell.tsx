import {
    createContext,
    useContext,
    useLayoutEffect,
    useState,
    type ReactNode,
    type Ref,
} from "react"

import {Button} from "@agenta/ui/ui"
import {ArrowSquareOut, PlayCircle} from "@phosphor-icons/react"
import clsx from "clsx"
import {createPortal} from "react-dom"

/** The frame every Settings tab renders in: a fixed title over a body that scrolls, centered at 1040px. */
export interface SettingsPageShellProps {
    title: ReactNode
    /** One sentence saying what the page is for. */
    description: ReactNode
    /** The tab's docs, linked at the end of the description. */
    docs?: {label: string; href: string}
    /** A walkthrough video beside the primary action; absent until the tab has one. */
    video?: {label: string; onOpen: () => void}
    /** `table` is the centered 1040px column; `full` drops the cap. */
    variant?: "full" | "table"
    /** The body's scroll box, for a host that watches its scroll position. */
    scrollRef?: Ref<HTMLDivElement>
    /** Extra classes on the body's scroll box, e.g. a scroll-edge fade. */
    scrollClassName?: string
    children: ReactNode
}

/** Where a tab's primary action renders: the header's slot inside a shell, `undefined` outside one. */
const HeaderActionsContext = createContext<HTMLElement | null | undefined>(undefined)

/** Hands a tab's primary action a slot in a host's own title row (a host that draws its own frame). */
export const SettingsHeaderActionsProvider = HeaderActionsContext.Provider

/** A tab's primary action on the title row; rendered in place outside a shell. */
export const SettingsPageActions = ({children}: {children: ReactNode}) => {
    const target = useContext(HeaderActionsContext)
    if (target === undefined) return <div className="mb-3 flex justify-end gap-2">{children}</div>
    return target ? createPortal(children, target) : null
}

/** Where a tab's toolbar renders: the page's pinned toolbar row, and how a tab claims it. */
export interface SettingsToolbarSlot {
    target: HTMLElement | null
    /** Shows the row while a tab's toolbar is mounted; returns the release. */
    register: () => () => void
}

const ToolbarSlotContext = createContext<SettingsToolbarSlot | undefined>(undefined)

/** Hands a tab's toolbar the host's pinned row, under the title and outside the scroll. */
export const SettingsToolbarSlotProvider = ToolbarSlotContext.Provider

/** A tab's toolbar (`PageToolbar`): pinned in the host's row, or in place outside one. */
export const SettingsPageToolbar = ({children}: {children: ReactNode}) => {
    const slot = useContext(ToolbarSlotContext)
    const register = slot?.register
    useLayoutEffect(() => register?.(), [register])
    if (slot === undefined) return <>{children}</>
    return slot.target ? createPortal(children, slot.target) : null
}

/** The centered column both the title and the body sit in, so their edges line up. */
const columnClassName = (variant: SettingsPageShellProps["variant"]) =>
    clsx(
        // `box-border` because preflight is off: `w-full` plus padding would overflow.
        "box-border w-full px-4 sm:px-6",
        variant !== "full" && "mx-auto max-w-content-lg",
    )

/** The walkthrough beside the primary action; on a phone it folds to its icon. */
export const SettingsVideoButton = ({video}: {video: {label: string; onOpen: () => void}}) => (
    <Button variant="ghost" onClick={video.onOpen} aria-label={video.label} title={video.label}>
        <PlayCircle aria-hidden />
        <span className="hidden sm:inline">{video.label}</span>
    </Button>
)

/** The tab's one sentence, with its docs link at the end. */
export const SettingsPageDescription = ({
    description,
    docs,
}: Pick<SettingsPageShellProps, "description" | "docs">) => (
    <>
        {description}
        {docs ? (
            <>
                {" "}
                <a
                    href={docs.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-inherit no-underline underline-offset-4 hover:text-foreground hover:underline"
                >
                    {docs.label}
                    <ArrowSquareOut size={12} />
                </a>
            </>
        ) : null}
    </>
)

const SettingsPageShell = ({
    title,
    description,
    docs,
    video,
    variant = "full",
    scrollRef,
    scrollClassName,
    children,
}: SettingsPageShellProps) => {
    const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
    return (
        <div
            className={clsx(
                "flex h-full min-h-0 w-full flex-col self-stretch",
                // Mobile has no antd base font, so the body scale is stated here.
                "text-body leading-[1.4285714285714286]",
            )}
        >
            <header
                className={clsx(
                    columnClassName(variant),
                    "flex shrink-0 flex-col gap-1.5 pb-7 pt-6 lg:pt-11",
                )}
            >
                <div className="flex min-w-0 items-center justify-between gap-4">
                    {/* Below `sm` the title drops to the 16px body ramp, like every page title on a
                    phone. `m-0` kills the UA margin (preflight is off). */}
                    <h1 className="m-0 min-w-0 truncate text-heading text-foreground">{title}</h1>

                    <div className="flex shrink-0 items-center gap-2">
                        {video ? <SettingsVideoButton video={video} /> : null}
                        <div
                            ref={setActionsSlot}
                            className="flex items-center gap-2 empty:hidden"
                        />
                    </div>
                </div>
                <p className="m-0 text-body leading-5 text-muted-foreground">
                    <SettingsPageDescription description={description} docs={docs} />
                </p>
            </header>

            <div
                ref={scrollRef}
                // On a phone the clip starts 12px higher, into the header's bottom padding, so a
                // control in the first row keeps its 44px tap area. Nothing moves.
                className={clsx(
                    "min-h-0 flex-1 overflow-y-auto max-md:-mt-3 max-md:pt-3",
                    scrollClassName,
                )}
            >
                <div className={clsx(columnClassName(variant), "flex flex-col pb-16")}>
                    <HeaderActionsContext.Provider value={actionsSlot}>
                        {children}
                    </HeaderActionsContext.Provider>
                </div>
            </div>
        </div>
    )
}

export default SettingsPageShell

import {createContext, useContext, useState, type ReactNode, type Ref} from "react"

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
    /** `table` is the centered 1040px column; `full` drops the cap (Audit Log). */
    variant?: "full" | "table"
    /** The body's scroll box, for a host that watches its scroll position. */
    scrollRef?: Ref<HTMLDivElement>
    /** Extra classes on the body's scroll box, e.g. a scroll-edge fade. */
    scrollClassName?: string
    children: ReactNode
}

/** Where a tab's primary action renders: the header's slot inside a shell, `undefined` outside one. */
const HeaderActionsContext = createContext<HTMLElement | null | undefined>(undefined)

/** A tab's primary action on the title row; rendered in place outside a shell. */
export const SettingsPageActions = ({children}: {children: ReactNode}) => {
    const target = useContext(HeaderActionsContext)
    if (target === undefined) return <div className="mb-3 flex justify-end gap-2">{children}</div>
    return target ? createPortal(children, target) : null
}

/** The centered column both the title and the body sit in, so their edges line up. */
const columnClassName = (variant: SettingsPageShellProps["variant"]) =>
    clsx(
        // `box-border` because preflight is off: `w-full` plus padding would overflow.
        "box-border w-full px-4 sm:px-8 lg:px-14",
        variant !== "full" && "mx-auto max-w-[1040px]",
    )

/** The walkthrough beside the primary action; on a phone it folds to its icon. */
const VideoButton = ({video}: {video: {label: string; onOpen: () => void}}) => (
    <Button variant="ghost" onClick={video.onOpen} aria-label={video.label} title={video.label}>
        <PlayCircle aria-hidden />
        <span className="hidden sm:inline">{video.label}</span>
    </Button>
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
                "text-[14px] leading-[1.4285714285714286]",
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
                    <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] tracking-[-0.01em] text-colorText sm:text-[24px] sm:leading-8">
                        {title}
                    </h1>

                    <div className="flex shrink-0 items-center gap-2">
                        {video ? <VideoButton video={video} /> : null}
                        <div
                            ref={setActionsSlot}
                            className="flex items-center gap-2 empty:hidden"
                        />
                    </div>
                </div>
                <p className="m-0 text-[14px] leading-5 text-colorTextSecondary">
                    {description}
                    {docs ? (
                        <>
                            {" "}
                            <a
                                href={docs.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 whitespace-nowrap text-inherit no-underline underline-offset-4 hover:text-colorText hover:underline"
                            >
                                {docs.label}
                                <ArrowSquareOut size={12} />
                            </a>
                        </>
                    ) : null}
                </p>
            </header>

            <div
                ref={scrollRef}
                className={clsx("min-h-0 flex-1 overflow-y-auto", scrollClassName)}
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

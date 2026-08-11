import {type ReactNode} from "react"

import {ArrowDown} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {Button} from "antd"
import {Virtuoso} from "react-virtuoso"

import {BOTTOM_FADE_OVERLAY_STYLE, EDGE_FADE_MASK} from "../assets/conversationLayout"
import {type ScrollIntent} from "../hooks/useScrollIntent"
import {type useTranscriptScroll} from "../hooks/useTranscriptScroll"
import {type VirtCtx, type useVirtuosoTranscript} from "../hooks/useVirtuosoTranscript"

/**
 * The scrollable message log and its jump-to-latest pill. Renders through whichever engine is
 * live — Virtuoso when it's enabled in the playground settings, the plain scroll container
 * otherwise — so both variants stay side by side under one set of layout decisions.
 */
const AgentTranscript = ({
    messages,
    activeStart,
    reserveActive,
    renderMessage,
    placeholder,
    virt,
    scroll,
    showJump,
}: {
    messages: UIMessage[]
    /** Index where the ACTIVE turn (last user message + its response) starts. */
    activeStart: number
    /** The active turn reserves a viewport, so the question can sit at the top. */
    reserveActive: boolean
    renderMessage: (message: UIMessage, index: number) => ReactNode
    /** Shown in place of the log while there are no messages. */
    placeholder: ReactNode
    virt: ReturnType<typeof useVirtuosoTranscript>
    scroll: ReturnType<typeof useTranscriptScroll>
    showJump: ScrollIntent["showJump"]
}) => {
    const useVirtuoso = virt.enabled
    return (
        <div className="ag-canvas relative flex min-h-0 flex-1 flex-col">
            {useVirtuoso && messages.length > 0 && (
                <Virtuoso<UIMessage, VirtCtx>
                    ref={virt.virtuosoRef}
                    scrollerRef={virt.setScroller}
                    data={messages.slice(0, activeStart)}
                    className="ag-canvas flex-1 [overflow-anchor:none]"
                    style={{
                        maskImage: EDGE_FADE_MASK,
                        WebkitMaskImage: EDGE_FADE_MASK,
                    }}
                    // Wide buffer so rows are rendered AND measured before they enter view — the
                    // height correction (85–1022px vs the estimate) then happens off-screen, so
                    // real content scrolls in without blanks or jitter. Tunable from settings.
                    increaseViewportBy={{
                        top: virt.overscan,
                        bottom: Math.round(virt.overscan * 0.66),
                    }}
                    defaultItemHeight={virt.itemEstimate}
                    // A prior mount's snapshot restores true row heights + scroll in the
                    // first frame; only a genuinely first visit anchors by index (the two
                    // props conflict, so exactly one is passed).
                    {...(virt.restoreState
                        ? {restoreStateFrom: virt.restoreState}
                        : {
                              initialTopMostItemIndex: {
                                  index: Math.max(0, activeStart - 1),
                                  align: "end" as const,
                              },
                          })}
                    computeItemKey={(_i, m) => m.id}
                    itemContent={(index, m) => (
                        <div className="px-3 pb-3">{renderMessage(m, index)}</div>
                    )}
                    atBottomStateChange={virt.onAtBottomStateChange}
                    context={{
                        header: <div className="pt-8" />,
                        footer:
                            activeStart < messages.length ? (
                                <div
                                    // `pb-8` ≥ the 28px bottom fade so the meta row clears it at rest.
                                    className={`flex flex-col gap-3 px-3 pb-8${reserveActive ? " pt-8" : ""}`}
                                    // Explicit viewport-height reserve (min-h-full is inert in the
                                    // Footer) so scrolling to bottom pins the question to the top.
                                    style={
                                        reserveActive && virt.viewportH
                                            ? {minHeight: virt.viewportH}
                                            : undefined
                                    }
                                >
                                    {messages
                                        .slice(activeStart)
                                        .map((m, i) => renderMessage(m, activeStart + i))}
                                </div>
                            ) : null,
                    }}
                    components={virt.components}
                />
            )}
            {(!useVirtuoso || messages.length === 0) && (
                <div
                    ref={scroll.attachScroll}
                    onScroll={scroll.onScroll}
                    // Capture a fresh SC-3 anchor before a click acts (expand/collapse a tool step,
                    // reasoning fold): those resize the transcript without a scroll, so onScroll never
                    // refreshes the anchor and the ResizeObserver would compensate against a stale one.
                    onPointerDownCapture={scroll.recordAnchor}
                    role="log"
                    aria-live="polite"
                    aria-label="Agent conversation"
                    // `pt-8`/`pb-8` (32px) ≥ the 28px fades so the first message and the last turn's
                    // meta row (Inspect turn + streaming dots) clear them at rest; the bottom pad
                    // + `[overflow-anchor:none]` are the SC scroll-engineering essentials (browser
                    // anchoring off so our pin/anchor logic owns the scroll position).
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pt-8 pb-8 [overflow-anchor:none]"
                    // Fade content into the top edge (under the tab bar) and the bottom edge (into the
                    // composer) as it scrolls. A gradient mask on the scroll container: transparent at
                    // each edge → opaque across the middle. GPU-composited, no JS, theme-agnostic.
                    style={{
                        maskImage: EDGE_FADE_MASK,
                        WebkitMaskImage: EDGE_FADE_MASK,
                    }}
                >
                    {messages.length === 0 && placeholder}
                    {messages.slice(0, activeStart).map((m, i) => renderMessage(m, i))}
                    {activeStart < messages.length && (
                        // The active turn reserves a viewport (min-h-full) when there's prior
                        // conversation, so sticking to the bottom shows the question at the top with the
                        // answer streaming into the space below — the "pin" is this layout, not JS.
                        // `pt-8` keeps the question clear of the top fade once it reaches the top.
                        <div
                            className={`flex flex-col gap-3${reserveActive ? " min-h-full pt-8" : ""}`}
                        >
                            {messages
                                .slice(activeStart)
                                .map((m, i) => renderMessage(m, activeStart + i))}
                        </div>
                    )}
                </div>
            )}

            {/* Bottom-edge fade, painted as a sibling OUTSIDE the scroll container's masked
            subtree (see EDGE_FADE_MASK's comment) so a hovering message's stats chip — z-10,
            deep inside that subtree — can render above it instead of being masked out. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 z-[5]"
                style={BOTTOM_FADE_OVERLAY_STYLE}
            />

            {/* Always mounted so it can fade + slide in/out; hidden state is non-interactive and
                keeps `-translate-x-1/2` (Tailwind composes x/y translate on one transform). */}
            <Button
                size="small"
                shape="round"
                icon={<ArrowDown size={14} />}
                onClick={useVirtuoso ? virt.jumpToLatest : scroll.jumpToLatest}
                tabIndex={showJump ? 0 : -1}
                aria-hidden={!showJump}
                // Solid elevated surface + border + shadow so the pill reads clearly when it
                // floats over streamed text (a transparent pill let the text bleed through).
                className={`!absolute bottom-2 left-1/2 -translate-x-1/2 !border !border-solid !border-colorBorderSecondary !bg-colorBgElevated shadow-md transition-[opacity,transform] duration-200 ease-out ${
                    showJump
                        ? "translate-y-0 opacity-100"
                        : "pointer-events-none translate-y-3 opacity-0"
                }`}
                aria-label="Jump to latest message"
            >
                Jump to latest
            </Button>
        </div>
    )
}

export default AgentTranscript

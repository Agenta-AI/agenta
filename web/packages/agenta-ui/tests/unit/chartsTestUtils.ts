import {vi} from "vitest"

/** jsdom has no layout: report a fixed width to every observed element. */
export function stubChartWidth(width = 480) {
    class FixedWidthObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe(target: Element) {
            this.callback(
                [{target, contentRect: {width} as DOMRectReadOnly} as ResizeObserverEntry],
                this as unknown as ResizeObserver,
            )
        }
        unobserve() {}
        disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FixedWidthObserver)
}

/** Numbers of an svg path or polygon `points` attribute, in order. */
export function numbersOf(text: string | null): number[] {
    return (text ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
}

// @vitest-environment jsdom
import {useEffect, useRef} from "react"

import {cleanup, render} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {SplitPane} from "../../src/components/ui/split-pane"

/**
 * `/m`'s session workspace drives ONE SplitPane at every width rather than a phone container plus
 * a tablet container, because a node rendered in two CSS-hidden containers still mounts twice —
 * which ran two chat engines at once. That fix rests on two SplitPane guarantees: each half mounts
 * exactly once, and collapsing a half (hidden class, `paneGrow`, `barHidden`) never unmounts it.
 */

afterEach(cleanup)

const Counter = ({onMount, label}: {onMount: () => void; label: string}) => {
    const counted = useRef(false)
    useEffect(() => {
        if (counted.current) return
        counted.current = true
        onMount()
    }, [onMount])
    return <div data-testid={label} />
}

/** The phone/tablet prop split the session workspace applies to the same element. */
const geometry = (twoPane: boolean, showBuild: boolean) => ({
    paneSize: twoPane ? 440 : 0,
    barHidden: !twoPane,
    resizable: twoPane,
    paneGrow: !twoPane && showBuild,
    paneClassName: !twoPane && !showBuild ? "hidden" : undefined,
    fillClassName: !twoPane && showBuild ? "hidden" : undefined,
})

describe("SplitPane mount stability", () => {
    it("mounts each half exactly once", () => {
        let panes = 0
        let fills = 0
        render(
            <SplitPane
                paneSide="start"
                {...geometry(false, false)}
                pane={<Counter label="pane" onMount={() => (panes += 1)} />}
                fill={<Counter label="fill" onMount={() => (fills += 1)} />}
            />,
        )

        expect(panes).toBe(1)
        expect(fills).toBe(1)
        expect(document.querySelectorAll('[data-testid="fill"]')).toHaveLength(1)
    })

    it("keeps both halves mounted across every width and mode", () => {
        let panes = 0
        let fills = 0
        const tree = (twoPane: boolean, showBuild: boolean) => (
            <SplitPane
                paneSide="start"
                {...geometry(twoPane, showBuild)}
                pane={<Counter label="pane" onMount={() => (panes += 1)} />}
                fill={<Counter label="fill" onMount={() => (fills += 1)} />}
            />
        )
        const {rerender} = render(tree(false, false))

        // Phone chat -> phone build -> tablet split -> back. A rotation must not drop a stream.
        rerender(tree(false, true))
        rerender(tree(true, true))
        rerender(tree(false, false))

        expect(panes).toBe(1)
        expect(fills).toBe(1)
    })

    it("lets the driven pane fill the width when the fill half is hidden", () => {
        const {container} = render(
            <SplitPane paneSide="start" {...geometry(false, true)} pane={<div />} fill={<div />} />,
        )

        const pane = container.querySelector<HTMLElement>('[data-slot="split-pane-pane"]')!
        const fill = container.querySelector<HTMLElement>('[data-slot="split-pane-fill"]')!
        // grow, not grow-0: a 0px basis with no growth would leave the visible half invisible.
        expect(pane.className).toContain("grow")
        expect(pane.className).not.toContain("grow-0")
        expect(fill.className).toContain("hidden")
        expect(container.querySelector('[data-slot="split-pane-bar"]')).toBeNull()
    })
})

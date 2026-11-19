import {useEffect, useRef} from "react"

import {
    BuilderHero,
    BuilderHeroFallback,
    type BuilderHeroHandle,
    type HeroState,
} from "@/features/builder-page/hero/BuilderHero"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * The hero of the builder new chat (B01): the gray "Strand ribbon" in its four states.
 * Use the Theme toolbar for light and dark. The typing story sends a keystroke bump about
 * every 180 ms, as a person typing does.
 */
const HeroDemo = ({state}: {state: HeroState}) => {
    const hero = useRef<BuilderHeroHandle>(null)
    useEffect(() => {
        if (state !== "typing") return
        const id = window.setInterval(() => hero.current?.pulse(), 180)
        return () => window.clearInterval(id)
    }, [state])
    return (
        <div data-testid="builder-hero" className="flex bg-background p-4">
            <BuilderHero ref={hero} state={state} />
        </div>
    )
}

const meta = {
    title: "BuilderLayout/hero/Builder hero",
    component: HeroDemo,
    parameters: {layout: "centered"},
} satisfies Meta<typeof HeroDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Idle: Story = {args: {state: "idle"}}
export const Typing: Story = {args: {state: "typing"}}
export const Thinking: Story = {args: {state: "thinking"}}
export const Done: Story = {args: {state: "done"}}

/** What the hero shows when the browser has no WebGL or loses it. */
export const Fallback: Story = {
    args: {state: "idle"},
    render: () => (
        <div data-testid="builder-hero" className="flex bg-background p-4">
            <div className="relative size-[220px]">
                <BuilderHeroFallback />
            </div>
        </div>
    ),
}

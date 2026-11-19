import {useEffect, useImperativeHandle, useRef, useState, type Ref} from "react"

import {cn} from "@/lib/utils"

import {HeroEngine} from "./heroEngine"
import type {HeroState} from "./heroMotion"
import {createStrandRibbonRenderer} from "./strandRibbonRenderer"

export type {HeroState}

export interface BuilderHeroHandle {
    /** Marks one keystroke with a small bump. */
    pulse: () => void
}

export interface BuilderHeroProps {
    state: HeroState
    /** Sets the size; the hero is 220 px square by default. */
    className?: string
    ref?: Ref<BuilderHeroHandle>
}

/**
 * The hero above the title of a new builder chat: the "Strand ribbon", drawn with WebGL.
 * It shows the still fallback when WebGL is missing or lost. The page that mounts it loads it
 * with next/dynamic, so the shader stays out of the route bundle.
 */
export function BuilderHero({state, className, ref}: BuilderHeroProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const engineRef = useRef<HeroEngine | null>(null)
    // The state at mount; later changes go through setState.
    const initialState = useRef(state)
    const [fallback, setFallback] = useState(false)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const engine = new HeroEngine(canvas, {
            state: initialState.current,
            createRenderer: createStrandRibbonRenderer,
            onFallback: setFallback,
        })
        engineRef.current = engine
        return () => {
            engine.destroy()
            engineRef.current = null
        }
    }, [])

    useEffect(() => {
        engineRef.current?.setState(state)
    }, [state])

    useImperativeHandle(ref, () => ({pulse: () => engineRef.current?.pulse()}), [])

    return (
        <div
            aria-hidden="true"
            data-hero-state={state}
            className={cn("relative size-[220px] shrink-0", className)}
        >
            <canvas
                ref={canvasRef}
                className={cn("absolute inset-0 size-full", fallback && "invisible")}
            />
            {fallback ? <BuilderHeroStill /> : null}
        </div>
    )
}

/** The still fallback: the app's three activity dots, at rest, in the text ink. */
export function BuilderHeroStill({className}: {className?: string}) {
    return (
        <svg
            data-hero-fallback=""
            viewBox="-100 -100 200 200"
            className={cn("absolute inset-0 size-full text-colorText", className)}
        >
            {[-30, 0, 30].map((x) => (
                <circle key={x} cx={x} cy={0} r={9} fill="currentColor" />
            ))}
        </svg>
    )
}

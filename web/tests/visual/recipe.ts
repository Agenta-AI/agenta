import {readFileSync} from "node:fs"

export interface StoryRecipe {
    id: string
    story: string
    width: number
    height: number
    theme: "light" | "dark"
    selector?: string
    /** Capture only after this selector is visible (a lazy view shows a skeleton first). */
    ready?: string
}

export interface ScreenStep {
    click?: string
    fill?: string
    press?: string
    wait?: string | number
    target?: string
    value?: string
}

export interface ScreenRecipe {
    id: string
    route: string
    width: number
    height: number
    theme: "light" | "dark"
    steps: ScreenStep[]
    selector?: string
}

/** A recipe file is one JSON array. A story recipe has `story`; a screen recipe has `route`. */
export function readRecipes(): Record<string, unknown>[] {
    const file = process.env.RECIPES
    if (!file) throw new Error("RECIPES is not set")
    return JSON.parse(readFileSync(file, "utf8"))
}

export function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value
}

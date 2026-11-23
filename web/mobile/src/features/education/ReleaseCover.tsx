import type {ReactNode} from "react"

import type {ReleaseCover as ReleaseCoverKind} from "@agenta/navigation"
import {DiscordLogo, TeamsLogo} from "@agenta/settings-ui/channel-icons"
import {Anthropic, Gemini, Mistral, OpenAi} from "@agenta/ui/llm-icons"
import dynamic from "next/dynamic"

import {cn} from "@/lib/utils"

// The ribbon's shader loads on its own, only when a builder cover is on screen.
const BuilderHero = dynamic(
    () => import("../builder-page/hero/BuilderHero").then((m) => m.BuilderHero),
    {ssr: false, loading: () => <div className="size-35 md:size-55" />},
)

// Proper names, so they stay the same in every app language.
const LANGUAGE_NAMES = ["English", "中文", "日本語", "Español", "Português", "Deutsch", "Français"]
const MODEL_NAMES = [
    "Gemini 4 Hydrogen",
    "Gemini 4 Carbon",
    "Gemini 4 Neon",
    "Claude Fable 5.2",
    "Claude Haiku 5.5",
    "GPT-6.2 Astra",
    "GPT-6.2 Sol",
    "GPT-6.1 Terra",
    "Mistral Large 4",
]

// Sizes the logo inside through the svg selector, so each breakpoint gets its own size.
const Tile = ({children, large = false}: {children: ReactNode; large?: boolean}) => (
    <span
        className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-foreground md:size-18 md:rounded-xl",
            large ? "[&>svg]:size-5 md:[&>svg]:size-10" : "[&>svg]:size-4 md:[&>svg]:size-9",
        )}
    >
        {children}
    </span>
)

const Chips = ({names, className}: {names: string[]; className?: string}) => (
    <div className={cn("flex flex-wrap justify-center gap-1", className)}>
        {names.map((name) => (
            <span
                key={name}
                className="rounded-sm border border-solid border-border-muted bg-background px-2 py-0.5 text-caption text-foreground"
            >
                {name}
            </span>
        ))}
    </div>
)

/** The picture above a release feature's title, built from logos and art the app already has. */
export const ReleaseCover = ({cover}: {cover: ReleaseCoverKind}) => (
    <div
        aria-hidden
        data-release-cover={cover}
        className={cn(
            "flex w-full flex-wrap content-center items-center justify-center gap-2 overflow-hidden rounded-xl bg-muted aspect-[16/7] md:gap-4",
            cover === "builder" ? "p-0" : "p-3 md:p-5",
        )}
    >
        {cover === "builder" ? (
            <BuilderHero state="idle" className="size-35 md:size-55" />
        ) : null}
        {cover === "channels" ? (
            <>
                <Tile large>
                    <DiscordLogo />
                </Tile>
                <Tile large>
                    <TeamsLogo />
                </Tile>
                <Chips names={LANGUAGE_NAMES} className="max-w-75" />
            </>
        ) : null}
        {cover === "models" ? (
            <>
                <Tile>
                    <Gemini />
                </Tile>
                <Tile>
                    <Anthropic />
                </Tile>
                <Tile>
                    <OpenAi />
                </Tile>
                <Tile>
                    <Mistral />
                </Tile>
                <Chips names={MODEL_NAMES} className="max-w-105" />
            </>
        ) : null}
    </div>
)

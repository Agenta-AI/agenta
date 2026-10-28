import {EmbedAvatar} from "./EmbedAvatar"
import type {EmbedAppearance} from "./embedConfig"

/** What an empty conversation opens with: who the visitor talks to, the greeting and starters. */
export const EmbedGreeting = ({
    appearance,
    disabled,
    onStarter,
}: {
    appearance: EmbedAppearance
    disabled: boolean
    onStarter: (text: string) => void
}) => (
    <div className="flex flex-col gap-3 p-1">
        <div className="flex flex-col items-start gap-2">
            <EmbedAvatar appearance={appearance} large />
            <span className="text-sm font-semibold text-foreground">{appearance.name}</span>
        </div>
        {appearance.greeting ? (
            <p className="m-0 whitespace-pre-line text-sm text-foreground">{appearance.greeting}</p>
        ) : null}
        {appearance.starters.length ? (
            <div className="flex flex-col items-start gap-2">
                {appearance.starters.map((starter) => (
                    <button
                        key={starter}
                        type="button"
                        disabled={disabled}
                        className="max-w-full cursor-pointer rounded-2xl border border-solid border-border bg-background px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:border-primary hover:bg-accent disabled:cursor-default disabled:opacity-50"
                        onClick={() => onStarter(starter)}
                    >
                        {starter}
                    </button>
                ))}
            </div>
        ) : null}
    </div>
)

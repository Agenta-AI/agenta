import {Button} from "@agenta/ui/ui"

import type {EmbedAppearance} from "./embedConfig"

/** The greeting and starter prompts an empty conversation opens with. */
export const EmbedGreeting = ({
    appearance,
    disabled,
    onStarter,
}: {
    appearance: EmbedAppearance
    disabled: boolean
    onStarter: (text: string) => void
}) => {
    if (!appearance.greeting && !appearance.starters.length) return null
    return (
        <div className="flex flex-col gap-3 p-4">
            {appearance.greeting ? (
                <p className="m-0 whitespace-pre-line text-sm text-foreground">
                    {appearance.greeting}
                </p>
            ) : null}
            {appearance.starters.length ? (
                <div className="flex flex-wrap gap-2">
                    {appearance.starters.map((starter) => (
                        <Button
                            key={starter}
                            variant="outline"
                            size="sm"
                            disabled={disabled}
                            className="h-auto max-w-full whitespace-normal py-1.5 text-left"
                            onClick={() => onStarter(starter)}
                        >
                            {starter}
                        </Button>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

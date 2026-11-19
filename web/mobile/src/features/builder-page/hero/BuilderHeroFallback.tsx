import {cn} from "@/lib/utils"

/** The fallback when WebGL is missing or lost: the app's three activity dots, at rest, in the text ink. */
export function BuilderHeroFallback({className}: {className?: string}) {
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

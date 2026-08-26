import {Skeleton} from "@/components/ui/skeleton"

/**
 * The waiting state for a tab whose body is not a shared page with its own `loading` prop —
 * a stack of section-sized bars, so the switch to real content does not jump.
 */
export const SettingsSectionSkeleton = () => (
    <div className="flex flex-col gap-3 py-2" aria-hidden>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-20 w-full" />
    </div>
)

/** A failed load says so and offers the retry — silence reads as "this org has no settings". */
export const SettingsLoadError = ({text, onRetry}: {text: string; onRetry: () => void}) => (
    <div className="flex flex-col items-start gap-2 py-2">
        <p className="text-destructive m-0 text-xs">{text}</p>
        <button
            type="button"
            onClick={onRetry}
            className="border-border hover:bg-accent cursor-pointer rounded-md border border-solid bg-transparent px-3 py-1.5 text-xs"
        >
            Try again
        </button>
    </div>
)

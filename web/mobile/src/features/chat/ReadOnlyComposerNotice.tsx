import {ContentRail} from "@/components/ContentRail"

/**
 * What takes the composer's place when the reader cannot send: the composer's own frame (same
 * height and radius) with a dashed border, a muted fill and centered gray text, so it never
 * reads as a message.
 */
export const ReadOnlyComposerNotice = ({text}: {text: string}) => (
    <div className="bg-background shrink-0 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <ContentRail>
            <div
                role="note"
                data-testid="read-only-composer"
                className="border-border bg-muted text-muted-foreground flex min-h-[108px] items-center justify-center rounded-lg border border-dashed px-6 py-4 text-center text-sm [text-wrap:pretty]"
            >
                {text}
            </div>
        </ContentRail>
    </div>
)

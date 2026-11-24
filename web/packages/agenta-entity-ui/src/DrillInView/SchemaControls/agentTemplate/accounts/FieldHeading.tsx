/** A part's heading in an item view's account block: a label and a one-line note. */

/** Canvas F02 f6, F03 f7: 13/20/600 and a 12/16 note; 14/20 on a phone (M09). `text-xs` is 13 px in /m. */
export function FieldHeading({label, note}: {label: string; note: string}) {
    return (
        <div className="flex flex-col gap-px">
            <span className="text-label font-semibold leading-5 text-foreground">{label}</span>
            <span className="text-meta text-muted-foreground">{note}</span>
        </div>
    )
}

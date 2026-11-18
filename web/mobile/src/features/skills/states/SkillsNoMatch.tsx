import {Button} from "@agenta/ui/ui"

/** The project has skills, but the search, the filters or the archived switch hid them. */
export const SkillsNoMatch = ({
    term,
    archived,
    onClear,
}: {
    term?: string
    archived: boolean
    onClear?: () => void
}) => (
    <div className="flex flex-col items-center gap-2.5 px-4 py-12 text-center text-sm text-muted-foreground">
        <span>
            {term
                ? `No skills match “${term}”.`
                : archived
                  ? "No archived skills."
                  : "No skills match these filters."}
        </span>
        {onClear ? (
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear search and filters
            </Button>
        ) : null}
    </div>
)

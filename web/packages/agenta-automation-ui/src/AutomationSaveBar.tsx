import {Button} from "@agenta/ui/ui"

/**
 * The detail screen's save footer — the same bar the draft screen creates from, so "finish this
 * automation" looks the same whether the automation exists yet or not.
 *
 * It STANDS whether or not there is anything to commit, disabled until there is: a bar that
 * appears only once you have typed leaves a reader who has typed nothing wondering how an edit
 * is meant to be saved, and a control that arrives mid-edit moves the ground under the cursor.
 */
export const AutomationSaveBar = ({
    dirty,
    saving,
    onDiscard,
    onSave,
    bare = false,
}: {
    /** The draft differs from what is saved. Nothing to save and nothing to throw away without it. */
    dirty: boolean
    saving: boolean
    onDiscard: () => void
    onSave: () => void
    /** In a drawer footer the rule and the top margin belong to the footer, not to this bar. */
    bare?: boolean
}) => (
    <div
        className={
            bare
                ? "flex items-center justify-end gap-2.5"
                : "mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5"
        }
    >
        <Button
            type="button"
            variant="outline"
            className="font-normal"
            disabled={saving || !dirty}
            onClick={onDiscard}
        >
            Discard
        </Button>
        <Button type="button" className="font-normal" disabled={saving || !dirty} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
        </Button>
    </div>
)

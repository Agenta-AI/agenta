import {Button} from "@agenta/ui/ui"

/**
 * The detail screen's unsaved-changes footer — the same bar the draft screen creates from, so
 * "finish this automation" looks the same whether the automation exists yet or not.
 *
 * It appears only when there is something to save: a footer standing over an unedited screen is a
 * permanent invitation to press a button that does nothing.
 */
export const AutomationSaveBar = ({
    saving,
    onDiscard,
    onSave,
    bare = false,
}: {
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
            size={bare ? "default" : "sm"}
            variant="outline"
            className={bare ? "font-normal" : "text-xs font-normal"}
            disabled={saving}
            onClick={onDiscard}
        >
            Discard
        </Button>
        <Button
            type="button"
            size={bare ? "default" : "sm"}
            className={bare ? "font-normal" : "text-xs font-normal"}
            disabled={saving}
            onClick={onSave}
        >
            {saving ? "Saving…" : "Save"}
        </Button>
    </div>
)

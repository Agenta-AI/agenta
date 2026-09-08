import {Button} from "@/components/ui/button"

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
}: {
    saving: boolean
    onDiscard: () => void
    onSave: () => void
}) => (
    <div className="mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5">
        <Button
            type="button"
            size="sm"
            variant="outline"
            className="font-normal"
            disabled={saving}
            onClick={onDiscard}
        >
            Discard
        </Button>
        <Button type="button" size="sm" className="font-normal" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
        </Button>
    </div>
)

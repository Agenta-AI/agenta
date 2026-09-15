/**
 * The Files pane's menu selection mark: a check on the RIGHT of a plain `DropdownMenuItem`,
 * invisible (but space-keeping) when the item isn't the selected one. Used in place of the kit's
 * checkbox / radio items, whose indicator sits on the left and indents every label.
 */
import {Check} from "@phosphor-icons/react"

export const SelectedMark = ({on, className = "ml-auto"}: {on: boolean; className?: string}) => (
    // Sized as the menu's own icons (size-4); padding on an svg would shrink the glyph.
    <Check
        aria-hidden
        className={`size-4 shrink-0 ${className} ${on ? "text-colorText" : "invisible"}`}
    />
)

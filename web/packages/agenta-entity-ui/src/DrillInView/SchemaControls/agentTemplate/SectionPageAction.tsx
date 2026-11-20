/**
 * SectionPageAction
 *
 * The action at the right of a section title on the Configuration page (canvas A04): "Change"
 * (Model), "Edit" (Instructions) or "Add" (the item lists). A bordered text button.
 */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {Button} from "@agenta/ui/ui"
import {PencilSimple, Plus} from "@phosphor-icons/react"

export interface SectionPageActionProps {
    action: "add" | "edit" | "change"
    onClick: () => void
    disabled?: boolean
}

export const SectionPageAction = ({action, onClick, disabled}: SectionPageActionProps) => {
    const t = useT(commonCatalog, configItemsCatalog)
    return (
        <Button
            variant="outline"
            // The canvas control size (h28, r6, 13 px); the shared `sm` size replaces it (lane 1).
            className="h-7 gap-1 rounded-md px-2.5 text-[13px]"
            disabled={disabled}
            onClick={onClick}
        >
            {action === "add" ? <Plus size={14} aria-hidden /> : null}
            {action === "edit" ? <PencilSimple size={14} aria-hidden /> : null}
            {action === "add"
                ? t("common.add")
                : action === "edit"
                  ? t("common.edit")
                  : t("entityUi.configItems.change")}
        </Button>
    )
}

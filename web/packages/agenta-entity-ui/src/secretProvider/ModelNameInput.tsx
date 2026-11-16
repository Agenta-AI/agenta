import {memo} from "react"

import {Button, Input, type InputProps} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"
import {useT} from "@agenta/i18n"
import customProviderFormCatalog from "@agenta/i18n/catalogs/entityUi.customProviderForm"

export interface ModelNameInputProps extends InputProps {
    onDelete: () => void
}

const ModelNameInput = ({onDelete, disabled, ...props}: ModelNameInputProps) => {
    const t = useT(customProviderFormCatalog)
    return (
        <div className="w-full relative">
            <Input
                placeholder={t("entityUi.customProviderForm.enterModelName")}
                className="w-full"
                disabled={disabled}
                {...props}
            />
            <Button
                variant="link"
                size="icon"
                className="absolute top-[1px] right-1"
                onClick={onDelete}
                disabled={disabled}
                aria-label={t("entityUi.customProviderForm.removeModel")}
            >
                <Trash size={14} />
            </Button>
        </div>
    )
}

export default memo(ModelNameInput)

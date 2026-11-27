import {useViewForm, useViewTitle, type ViewProps} from "@agenta/ui/view-stack"

import {SecretFormFields, useSecretFormSetup} from "../useSecretFormSetup"

import type {SecretFormViewParams} from "./secretFormView"

export {secretFormDirty} from "../useSecretFormSetup"

const SecretFormViewBody = ({params}: ViewProps<SecretFormViewParams>) => {
    const setup = useSecretFormSetup(params)
    useViewTitle(setup.title)
    useViewForm({
        dirty: setup.dirty,
        valid: setup.valid,
        save: setup.save,
        saveLabel: setup.saveLabel,
    })

    return (
        <div className="flex flex-col gap-4 px-4 py-3">
            <SecretFormFields setup={setup} />
        </div>
    )
}

export default SecretFormViewBody

import {Button} from "@agenta/primitive-ui/components/button"
import {SharedEditor} from "@agenta/ui/shared-editor"
import clsx from "clsx"

const ConfigurationView = () => {
    return (
        <div className={clsx(["flex-1 flex flex-col gap-6"])}>
            <div className={clsx(["flex items-center justify-between"])}>
                <span className="font-medium text-sm">Configuration</span>
                <Button variant="outline">Revert</Button>
            </div>

            <SharedEditor
                header={<span className={clsx(["font-[500]"])}>App name *</span>}
                initialValue={"custom_app"}
                handleChange={() => {}}
                state="readOnly"
                editorClassName="!border-none !shadow-none px-0"
                className="py-1 px-[11px] !w-auto"
                useAntdInput
                disabled
            />

            <SharedEditor
                header={<span className={clsx(["font-[500]"])}>Workflow URL *</span>}
                initialValue={"http://localhost/services/custom"}
                handleChange={() => {}}
                state="readOnly"
                editorClassName="!border-none !shadow-none px-0"
                className="py-1 px-[11px] !w-auto"
                useAntdInput
                disabled
            />

            <SharedEditor
                header={<span className={clsx(["font-[500]"])}>Description</span>}
                initialValue={""}
                handleChange={() => {}}
                state="readOnly"
                placeholder="Enter app name"
                editorClassName="!border-none !shadow-none px-0"
                className="py-1 px-[11px] !w-auto"
                useAntdInput
                disabled
            />
        </div>
    )
}

export default ConfigurationView

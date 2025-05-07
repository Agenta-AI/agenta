import {Button, Typography} from "antd"
import clsx from "clsx"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

const ConfigurationView = () => {
    return (
        <div className={clsx(["flex-1 flex flex-col gap-6"])}>
            <div className={clsx(["flex items-center justify-between"])}>
                <Typography className="font-medium text-sm">Configuration</Typography>
                <Button>Revert</Button>
            </div>

            <SharedEditor
                header={<Typography className={clsx(["font-[500]"])}>App name *</Typography>}
                initialValue={"custom_app"}
                handleChange={() => {}}
                state="readOnly"
                editorClassName="!border-none !shadow-none px-0"
                className="py-1 px-[11px] !w-auto"
                useAntdInput
                disabled
            />

            <SharedEditor
                header={<Typography className={clsx(["font-[500]"])}>Workflow URL *</Typography>}
                initialValue={"http://localhost/services/custom"}
                handleChange={() => {}}
                state="readOnly"
                editorClassName="!border-none !shadow-none px-0"
                className="py-1 px-[11px] !w-auto"
                useAntdInput
                disabled
            />

            <SharedEditor
                header={<Typography className={clsx(["font-[500]"])}>Description</Typography>}
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

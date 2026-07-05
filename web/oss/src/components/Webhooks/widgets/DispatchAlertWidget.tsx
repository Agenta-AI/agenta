import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Info} from "@phosphor-icons/react"
import {Form} from "antd"

export const DispatchAlertWidget = () => {
    const form = Form.useFormInstance()
    const subType = Form.useWatch("github_sub_type", form) || "repository_dispatch"

    return (
        <Alert variant="info" icon={<Info size={16} />} className="mb-0">
            <AlertTitle>
                {subType === "repository_dispatch"
                    ? "Triggers a generic 'repository_dispatch' Github event."
                    : "Triggers a specific workflow file manually based on inputs."}
            </AlertTitle>
        </Alert>
    )
}

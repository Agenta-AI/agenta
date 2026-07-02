import {Alert, Form} from "antd"

export const DispatchAlertWidget = () => {
    const form = Form.useFormInstance()
    const subType = Form.useWatch("github_sub_type", form) || "repository_dispatch"

    return (
        <Alert
            type="info"
            showIcon
            message={
                subType === "repository_dispatch"
                    ? "Triggers a generic 'repository_dispatch' Github event."
                    : "Triggers a specific workflow file manually based on inputs."
            }
            className="mb-0"
        />
    )
}

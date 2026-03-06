import React from "react"

import {Alert, Button, Form, Input, Radio, Space} from "antd"

import {REPO_PATTERN} from "../constants"

interface Props {
    isEditMode: boolean
}

export const GitHubFields: React.FC<Props> = ({isEditMode}) => {
    const form = Form.useFormInstance()
    const subType = Form.useWatch("github_sub_type", form) || "repository_dispatch"
    const [isChangingPat, setIsChangingPat] = React.useState(false)

    return (
        <Space direction="vertical" size="large" className="w-full">
            {/* Event Type selector */}
            <Form.Item name="github_sub_type" initialValue="repository_dispatch" className="!mb-2">
                <Radio.Group disabled={isEditMode} className="flex w-full">
                    <Radio.Button value="repository_dispatch" className="flex-1 text-center">
                        Repository Dispatch
                    </Radio.Button>
                    <Radio.Button value="workflow_dispatch" className="flex-1 text-center">
                        Workflow Dispatch
                    </Radio.Button>
                </Radio.Group>
            </Form.Item>

            <Alert
                type="info"
                showIcon
                message={
                    subType === "repository_dispatch"
                        ? "Triggers a generic 'repository_dispatch' Github event."
                        : "Triggers a specific workflow file manually based on inputs."
                }
                className="mb-4"
            />

            {/* Target Repository */}
            <Form.Item
                name="github_repo"
                label="Target Repository"
                rules={[
                    {required: true, message: "Repository is required"},
                    {
                        pattern: REPO_PATTERN,
                        message: "Repository must format as 'owner/repo'",
                    },
                ]}
                extra="e.g. Agenta-AI/agenta"
            >
                <Input placeholder="owner/repo" />
            </Form.Item>

            {/* Workflow Dispatch specific properties */}
            {subType === "workflow_dispatch" && (
                <>
                    <Form.Item
                        name="github_workflow"
                        label="Workflow File"
                        rules={[{required: true, message: "Workflow file name is required"}]}
                        extra="e.g. deploy.yml or action.yaml"
                    >
                        <Input placeholder="workflow.yml" />
                    </Form.Item>

                    <Form.Item
                        name="github_branch"
                        label="Branch/Ref"
                        initialValue="main"
                        rules={[{required: true, message: "Branch name is required"}]}
                    >
                        <Input placeholder="main" />
                    </Form.Item>
                </>
            )}

            {/* Personal Access Token */}
            <Form.Item
                name="github_pat"
                label="Personal Access Token"
                rules={[{required: !isEditMode || isChangingPat, message: "PAT is required"}]}
                extra={
                    <div className="flex items-start justify-between">
                        <span>A token with 'repo' scope. It will not be readable after save.</span>
                        {isEditMode && !isChangingPat && (
                            <Button
                                type="link"
                                size="small"
                                className="!p-0"
                                onClick={() => {
                                    setIsChangingPat(true)
                                    form.setFieldValue("github_pat", undefined)
                                }}
                            >
                                Change token
                            </Button>
                        )}
                    </div>
                }
            >
                <Input.Password
                    placeholder={isEditMode && !isChangingPat ? "•••••••••••••••••" : "ghp_..."}
                    disabled={isEditMode && !isChangingPat}
                />
            </Form.Item>
        </Space>
    )
}

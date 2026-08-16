import {ProjectsPage} from "@agenta/settings-ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {Trash} from "@phosphor-icons/react"
import {Form, Input, Switch} from "antd"

import useURL from "@/oss/hooks/useURL"
import {useProjectData} from "@/oss/state/project"

interface ProjectFormValues {
    name: string
    make_default?: boolean
}

/** OSS binding: the shared projects table with this app's antd form dialogs. */
const ProjectsSettings = () => {
    const {projects, isLoading} = useProjectData()
    const {workspaceId} = useURL()
    const [createForm] = Form.useForm<ProjectFormValues>()
    const [renameForm] = Form.useForm<ProjectFormValues>()

    return (
        <ProjectsPage
            projects={projects ?? []}
            isLoading={isLoading}
            workspaceId={workspaceId}
            renderCreateDialog={({open, onClose, onSubmit, pending}) => (
                <EnhancedModal
                    title="Create project"
                    open={open}
                    okText="Create"
                    // `afterClose`, not `onCancel`: closing by a successful create also closes the
                    // dialog, and resetting only on cancel left the last project's name sitting in
                    // the field the next time it opened.
                    afterClose={() => createForm.resetFields()}
                    onCancel={onClose}
                    onOk={() => createForm.submit()}
                    confirmLoading={pending}
                >
                    <Form form={createForm} layout="vertical" onFinish={onSubmit}>
                        <Form.Item
                            label="Project name"
                            name="name"
                            rules={[{required: true, message: "Please enter a project name"}]}
                        >
                            <Input placeholder="e.g. Production evaluation" autoFocus />
                        </Form.Item>
                        <Form.Item
                            label="Make default project"
                            name="make_default"
                            valuePropName="checked"
                            extra="The default project is used whenever a workspace is selected from the navigation."
                        >
                            <Switch />
                        </Form.Item>
                    </Form>
                </EnhancedModal>
            )}
            renderRenameDialog={({open, onClose, onSubmit, pending, project}) => (
                <EnhancedModal
                    title="Rename project"
                    open={open}
                    okText="Save"
                    afterOpenChange={(visible) => {
                        if (visible) renameForm.setFieldsValue({name: project?.project_name})
                    }}
                    afterClose={() => renameForm.resetFields()}
                    onCancel={onClose}
                    onOk={() => renameForm.submit()}
                    confirmLoading={pending}
                >
                    <Form form={renameForm} layout="vertical" onFinish={onSubmit}>
                        <Form.Item
                            label="Project name"
                            name="name"
                            rules={[{required: true, message: "Please enter a project name"}]}
                        >
                            <Input placeholder="Project name" />
                        </Form.Item>
                    </Form>
                </EnhancedModal>
            )}
            renderDeleteDialog={({open, onClose, onSubmit, pending, project}) => (
                <EnhancedModal
                    title="Delete project"
                    open={open}
                    okText="Delete project"
                    okType="danger"
                    okButtonProps={{icon: <Trash size={14} />, type: "primary"}}
                    onCancel={onClose}
                    onOk={() => onSubmit()}
                    confirmLoading={pending}
                    width={450}
                >
                    <div className="flex flex-col gap-1 rounded-lg border border-solid border-colorErrorBorder bg-colorErrorBg px-4 py-3">
                        <span className="font-medium text-colorError">
                            This action cannot be undone.
                        </span>
                        <span className="text-colorText">
                            Permanently deletes {project?.project_name}, including all of its
                            agents, datasets, and deployments.
                        </span>
                    </div>
                </EnhancedModal>
            )}
        />
    )
}

export default ProjectsSettings

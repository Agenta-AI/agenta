import type {Folder} from "@agenta/entities/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {fn} from "storybook/test"

import {ArchivePromptDialog} from "../../../mobile/src/features/prompts/dialogs/ArchivePromptDialog"
import {DeleteFolderDialog} from "../../../mobile/src/features/prompts/dialogs/DeleteFolderDialog"
import {FolderNameDialog} from "../../../mobile/src/features/prompts/dialogs/FolderNameDialog"
import {MoveToFolderDialog} from "../../../mobile/src/features/prompts/dialogs/MoveToFolderDialog"
import {RenamePromptDialog} from "../../../mobile/src/features/prompts/dialogs/RenamePromptDialog"

const FOLDERS: Folder[] = [
    {id: "support", name: "Support", slug: "support"},
    {id: "sales", name: "Sales", slug: "sales"},
    {id: "emails", name: "Emails", slug: "emails", parent_id: "support"},
    {id: "refunds", name: "Refunds", slug: "refunds", parent_id: "emails"},
]

const meta = {
    title: "@agenta/mobile/Developer/Prompts/Dialogs",
    parameters: {layout: "fullscreen"},
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const handlers = {onSubmit: fn(), onConfirm: fn(), onClose: fn()}

export const NewFolder: Story = {
    render: () => (
        <FolderNameDialog
            open
            mode="create"
            initialName="Customer replies"
            pathFor={(name) => `support/${name.toLowerCase().replace(/\s+/g, "-")}`}
            {...handlers}
        />
    ),
}

export const RenameFolder: Story = {
    render: () => (
        <FolderNameDialog
            open
            mode="rename"
            initialName="Emails"
            pathFor={(name) => `support/${name.toLowerCase()}`}
            {...handlers}
        />
    ),
}

export const NewFolderError: Story = {
    render: () => (
        <FolderNameDialog
            open
            mode="create"
            initialName="Emails"
            pathFor={(name) => `support/${name.toLowerCase()}`}
            error="A folder with this path already exists in this project."
            {...handlers}
        />
    ),
}

export const MoveFolder: Story = {
    render: () => (
        <MoveToFolderDialog
            open
            itemName="Emails"
            folders={FOLDERS}
            initialSelectedId="emails"
            isDisabled={(id) => ["emails", "refunds", "support"].includes(id)}
            {...handlers}
        />
    ),
}

export const MovePrompt: Story = {
    render: () => (
        <MoveToFolderDialog
            open
            itemName="Welcome email"
            folders={FOLDERS}
            initialSelectedId="emails"
            isDisabled={(id) => id === "emails"}
            {...handlers}
        />
    ),
}

export const DeleteFolder: Story = {
    render: () => <DeleteFolderDialog open folderName="Emails" {...handlers} />,
}

export const ArchivePrompt: Story = {
    render: () => <ArchivePromptDialog open promptName="Welcome email" {...handlers} />,
}

export const RenamePrompt: Story = {
    render: () => (
        <RenamePromptDialog
            open
            initialName="Welcome email"
            initialDescription="Sent on the first day."
            {...handlers}
        />
    ),
}

export const Pending: Story = {
    render: () => (
        <FolderNameDialog
            open
            mode="create"
            initialName="Customer replies"
            pathFor={(name) => name.toLowerCase()}
            pending
            {...handlers}
        />
    ),
}

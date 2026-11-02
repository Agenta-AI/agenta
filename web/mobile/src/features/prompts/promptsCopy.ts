/**
 * Every string of the Prompts page. Lines marked "new" have no text in the old app.
 */
export const promptsCopy = {
    pageTitle: "Prompts",
    searchPlaceholder: "Search",
    createNew: "Create new",
    newFolder: "New folder",
    rootLabel: "All prompts",
    folderTag: "Folder",
    columns: {name: "Name", modified: "Date modified", type: "Type", actions: "Actions"},
    rowMenuLabel: "Actions",
    menu: {
        open: "Open",
        rename: "Rename",
        move: "Move",
        delete: "Delete",
        archive: "Archive",
    },
    folderDialog: {
        createTitle: "New folder",
        renameTitle: "Rename folder",
        description: "Choose a folder name.",
        placeholder: "Untitled folder",
        create: "Create",
        save: "Save",
        cancel: "Cancel",
        slug: (slug: string) => `Slug: ${slug}`,
        path: (path: string) => `Folder path: ${path}`,
    },
    moveDialog: {
        title: "Move to folder",
        moving: (name: string) => `Moving ${name || "folder"}`,
        selectLabel: "Select folder",
        confirm: (destination: string | null) =>
            destination ? `Move to ${destination}` : "Move folder",
        cancel: "Cancel",
    },
    deleteDialog: {
        title: "Are you sure you want to delete?",
        description: "This action is not reversible.",
        about: "You are about to delete:",
        fallbackName: "this folder",
        confirm: "Delete",
    },
    archiveDialog: {
        title: "Archive app",
        text: (name: string) => `${name} will move to archived apps.`,
        confirm: "Archive app",
    },
    renamePromptDialog: {
        title: "Rename prompt",
        nameLabel: "Name",
        descriptionLabel: "Description",
        descriptionPlaceholder: "Add a short description…",
        save: "Save changes",
        emptyName: "Name can't be empty",
    },
    toast: {
        folderCreated: "Folder created",
        folderRenamed: "Folder renamed",
        folderMoved: "Folder moved",
        folderDeleted: "Folder deleted",
        appMoved: "App moved",
        appArchived: "App archived",
    },
    guard: {
        noDestination: "Select a destination folder",
        sameParent: "Select a different folder to move to",
        intoItself: "Cannot move a folder into itself",
        notFound: "Folder not found",
    },
    // New copy: the old app showed an empty message or the raw server text for these.
    failure: {
        saveFolder: "Couldn't save the folder",
        moveFolder: "Couldn't move the folder",
        deleteFolder: "Couldn't delete the folder",
        movePrompt: "Couldn't move this prompt",
        renamePrompt: "Couldn't rename this prompt",
        archivePrompt: "Failed to archive app",
    },
    states: {
        loadErrorTitle: "Could not load prompts",
        emptyProject: "No prompts yet",
        emptyFolder: "This folder is empty",
        noMatch: "No prompts match",
    },
} as const

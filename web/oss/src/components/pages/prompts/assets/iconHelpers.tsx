import React from "react"

import {ChatDotsIcon, NoteIcon} from "@phosphor-icons/react"

import CompletionAppIcon from "../components/CompletionAppIcon"
import SetupWorkflowIcon from "../components/SetupWorkflowIcon"

export const getAppTypeIcon = (appType?: string) => {
    const normalizedType = appType?.toLowerCase()

    if (normalizedType?.includes("chat"))
        return <ChatDotsIcon size={16} className="text-zinc-9 dark:text-white" />
    if (normalizedType?.includes("completion"))
        return <CompletionAppIcon className="text-zinc-9 dark:text-white" />
    if (normalizedType?.includes("custom"))
        return <SetupWorkflowIcon className="text-zinc-9 dark:text-white" />

    return <NoteIcon size={16} />
}

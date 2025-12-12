import React from "react"

import {ChatDotsIcon, NoteIcon} from "@phosphor-icons/react"

import CompletionAppIcon from "../components/CompletionAppIcon"
import SetupWorkflowIcon from "../components/SetupWorkflowIcon"

export const getAppTypeIcon = (appType?: string) => {
    const normalizedType = appType?.toLowerCase()

    if (normalizedType?.includes("completion")) return <ChatDotsIcon size={16} />
    if (normalizedType?.includes("chat")) return <CompletionAppIcon />
    if (normalizedType?.includes("custom")) return <SetupWorkflowIcon className="" />

    return <NoteIcon size={16} />
}

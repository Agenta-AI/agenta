import {DEFAULT_UUID, getCurrentProject} from "@/oss/contexts/project.context"

import {ListAppsItem} from "../Types"

import useStatelessVariants from "./useStatelessVariants"

export const useVariants = (app: Pick<ListAppsItem, "app_type" | "app_id"> | null) => {
    return !app ||
        !app.app_type ||
        (!!app.app_type && app.app_type.includes("old")) ||
        getCurrentProject().projectId === DEFAULT_UUID
        ? () => ({})
        : useStatelessVariants
}

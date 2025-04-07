import {ListAppsItem} from "../Types"

import useStatelessVariants from "./useStatelessVariants"

export const useVariants = (app: Pick<ListAppsItem, "app_type" | "app_id"> | null) =>
    !app || !app.app_type || (!!app.app_type && app.app_type.includes("old"))
        ? () => null
        : useStatelessVariants

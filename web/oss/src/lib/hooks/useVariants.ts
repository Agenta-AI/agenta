import {ListAppsItem} from "../Types"

import useStatelessVariants from "./useStatelessVariants"

export const useVariants = (app: Pick<ListAppsItem, "app_type" | "app_id"> | null) => {
    return useStatelessVariants
}

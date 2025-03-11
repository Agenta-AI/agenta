import {ListAppsItem} from "../Types"

import {useLegacyVariants} from "./useLegacyVariant"
import useStatelessVariants from "./useStatelessVariant"

export const useVariants = (app: Pick<ListAppsItem, "app_type" | "app_id"> | null) =>
    !app
        ? () => null
        : !app.app_type || (!!app.app_type && app.app_type.includes("old"))
          ? useLegacyVariants
          : useStatelessVariants

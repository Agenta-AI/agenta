import {useLegacyVariant, useLegacyVariants} from "./useLegacyVariant"
import useStatelessVariants from "./useStatelessVariant"

export const useVariants = (app) =>
    !app ? () => {} : app.app_type.includes("old") ? useLegacyVariants : useStatelessVariants

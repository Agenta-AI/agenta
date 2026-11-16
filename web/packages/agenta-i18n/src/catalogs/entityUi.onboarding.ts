import en from "../../locales/en/entityUi.onboarding.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.onboarding",
    en,
    (language) => import(`../../locales/${language}/entityUi.onboarding.json`),
)

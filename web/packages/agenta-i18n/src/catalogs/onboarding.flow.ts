import en from "../../locales/en/onboarding.flow.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "onboarding.flow",
    en,
    (language) => import(`../../locales/${language}/onboarding.flow.json`),
)

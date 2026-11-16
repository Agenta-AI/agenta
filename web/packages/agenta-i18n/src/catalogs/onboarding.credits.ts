import en from "../../locales/en/onboarding.credits.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "onboarding.credits",
    en,
    (language) => import(`../../locales/${language}/onboarding.credits.json`),
)

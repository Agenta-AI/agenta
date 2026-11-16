import en from "../../locales/en/onboarding.questions.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "onboarding.questions",
    en,
    (language) => import(`../../locales/${language}/onboarding.questions.json`),
)

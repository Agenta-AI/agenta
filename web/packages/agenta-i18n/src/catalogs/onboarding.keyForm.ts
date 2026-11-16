import en from "../../locales/en/onboarding.keyForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "onboarding.keyForm",
    en,
    (language) => import(`../../locales/${language}/onboarding.keyForm.json`),
)

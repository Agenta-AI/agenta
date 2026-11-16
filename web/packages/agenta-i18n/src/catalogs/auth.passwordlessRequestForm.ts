import en from "../../locales/en/auth.passwordlessRequestForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.passwordlessRequestForm",
    en,
    (language) => import(`../../locales/${language}/auth.passwordlessRequestForm.json`),
)

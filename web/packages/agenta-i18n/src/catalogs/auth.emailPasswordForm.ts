import en from "../../locales/en/auth.emailPasswordForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.emailPasswordForm",
    en,
    (language) => import(`../../locales/${language}/auth.emailPasswordForm.json`),
)

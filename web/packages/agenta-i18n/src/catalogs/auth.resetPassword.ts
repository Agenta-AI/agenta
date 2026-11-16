import en from "../../locales/en/auth.resetPassword.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.resetPassword",
    en,
    (language) => import(`../../locales/${language}/auth.resetPassword.json`),
)

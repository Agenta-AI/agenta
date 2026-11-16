import en from "../../locales/en/auth.emailFirstForm.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.emailFirstForm",
    en,
    (language) => import(`../../locales/${language}/auth.emailFirstForm.json`),
)

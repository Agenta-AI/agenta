import en from "../../locales/en/shell.sessionFilter.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "shell.sessionFilter",
    en,
    (language) => import(`../../locales/${language}/shell.sessionFilter.json`),
)

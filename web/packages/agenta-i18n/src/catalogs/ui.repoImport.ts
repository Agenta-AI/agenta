import en from "../../locales/en/ui.repoImport.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.repoImport",
    en,
    (language) => import(`../../locales/${language}/ui.repoImport.json`),
)

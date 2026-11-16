import en from "../../locales/en/ui.editor.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.editor",
    en,
    (language) => import(`../../locales/${language}/ui.editor.json`),
)

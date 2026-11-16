import en from "../../locales/en/ui.controls.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.controls",
    en,
    (language) => import(`../../locales/${language}/ui.controls.json`),
)

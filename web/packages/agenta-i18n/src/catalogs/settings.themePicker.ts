import en from "../../locales/en/settings.themePicker.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.themePicker",
    en,
    (language) => import(`../../locales/${language}/settings.themePicker.json`),
)

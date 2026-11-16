import en from "../../locales/en/automations.model.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "automations.model",
    en,
    (language) => import(`../../locales/${language}/automations.model.json`),
)

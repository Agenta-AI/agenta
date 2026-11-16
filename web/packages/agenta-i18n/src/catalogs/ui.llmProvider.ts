import en from "../../locales/en/ui.llmProvider.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "ui.llmProvider",
    en,
    (language) => import(`../../locales/${language}/ui.llmProvider.json`),
)

import en from "../../locales/en/playground.inputs.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.inputs",
    en,
    (language) => import(`../../locales/${language}/playground.inputs.json`),
)

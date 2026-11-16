import en from "../../locales/en/channels.labels.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "channels.labels",
    en,
    (language) => import(`../../locales/${language}/channels.labels.json`),
)

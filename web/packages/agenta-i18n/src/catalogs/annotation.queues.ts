import en from "../../locales/en/annotation.queues.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "annotation.queues",
    en,
    (language) => import(`../../locales/${language}/annotation.queues.json`),
)

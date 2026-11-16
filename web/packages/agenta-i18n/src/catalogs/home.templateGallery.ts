import en from "../../locales/en/home.templateGallery.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.templateGallery",
    en,
    (language) => import(`../../locales/${language}/home.templateGallery.json`),
)

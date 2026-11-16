import en from "../../locales/en/shell.commandPalette.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "shell.commandPalette",
    en,
    (language) => import(`../../locales/${language}/shell.commandPalette.json`),
)

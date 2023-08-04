import { useAppTheme } from "@/components/Layout/ThemeContextProvider";
import { useMemo } from "react";

export default function useLogo() {
    const {appTheme} = useAppTheme()
    const logoSrc = useMemo(
        () =>
            appTheme === "dark"
                ? "/assets/dark-complete-transparent-CROPPED.png"
                : "/assets/light-complete-transparent-CROPPED.png",
        [appTheme],
    )

    return logoSrc
}

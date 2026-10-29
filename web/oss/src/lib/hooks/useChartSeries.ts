import {ThemeMode, useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {chartSeries} from "@/oss/lib/helpers/chartPalette"

export const useIsDarkTheme = (): boolean => useAppTheme().appTheme === ThemeMode.Dark

/** The ordered categorical series set for the active theme. */
export const useChartSeries = (): string[] => chartSeries(useIsDarkTheme())

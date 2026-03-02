import React from "react";
import clsx from "clsx";
import {useColorMode} from '@docusaurus/theme-common';

type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;

export type IconDescriptor = {
  name: string;
  library?: string;
};

type IconLibrary = Record<string, IconComponent>;

// Base props for stroke-based icons (light mode)
const strokeSvgProps: React.SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "square",
  xmlns: "http://www.w3.org/2000/svg",
};

// Base props for filled icons (dark mode)
const filledSvgProps: React.SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "currentColor",
  xmlns: "http://www.w3.org/2000/svg",
};

const FileTextIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M4 2H20V22H4V2ZM8 6V8H16V6H8ZM8 10V12H16V10H8ZM8 14V16H12V14H8Z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props}>
      <path d="M9 7H15M9 11H15M9 15H11M5 3H19V21H5V3Z" />
    </svg>
  );
};

const LayersIcon: IconComponent = (props) => (
  <svg {...strokeSvgProps} {...props}>
    <path d="M12 4l8 4-8 4-8-4 8-4z" />
    <path d="M4 12l8 4 8-4" />
    <path d="M4 16l8 4 8-4" />
  </svg>
);

const CodeIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M3 3H21V21H3V3ZM9.79289 8.29289L11.2071 9.70711L8.91421 12L11.2071 14.2929L9.79289 15.7071L6.08579 12L9.79289 8.29289ZM12.7929 9.70711L15.0858 12L12.7929 14.2929L14.2071 15.7071L17.9142 12L14.2071 8.29289L12.7929 9.70711Z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props}>
      <path d="M10.5 9L7.5 12L10.5 15M13.5 9L16.5 12L13.5 15M4 4H20V20H4V4Z" />
    </svg>
  );
};

const BookOpenIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path d="M11 8C11 5.79086 9.20914 4 7 4H1V20H9C10.1046 20 11 20.8954 11 22V8Z" />
      <path d="M13 22C13 20.8954 13.8954 20 15 20H23V4H17C14.7909 4 13 5.79086 13 8V22Z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props} strokeLinecap="round">
      <path d="M12 8C12 6.34315 10.6569 5 9 5H2V19H9C10.6569 19 12 20.3431 12 22M12 8C12 6.34315 13.3431 5 15 5H22V19H15C13.3431 19 12 20.3431 12 22M12 8V22" />
    </svg>
  );
};

const RouteIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M19.5 3L23.25 8L19.5 13H13V21H11V17H4.5L0.75 12L4.5 7H11V3H19.5ZM13 5V11H18.5L20.75 8L18.5 5H13Z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props}>
      <path d="M12 12H19L22 8L19 4H12V8M12 12V8M12 12V16M12 8H5L2 12L5 16H12M12 16V20" />
    </svg>
  );
};

const HistoryIcon: IconComponent = (props) => (
  <svg {...strokeSvgProps} {...props}>
    <path d="M12 8v4l3 3" />
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 5v4h4" />
  </svg>
);

const ClockIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22ZM11 12.4142V7H13V11.5858L15.9142 14.5L14.5 15.9142L11 12.4142Z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props}>
      <path d="M12 8V12L14.5 14.5M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" />
    </svg>
  );
};

const CookbookIcon: IconComponent = (props) => (
  <svg {...strokeSvgProps} {...props}>
    <circle cx="8.5" cy="8" r="2.1" />
    <circle cx="12" cy="6.5" r="2.4" />
    <circle cx="15.5" cy="8" r="2.1" />
    <path d="M5 11h14v3.5a3.5 3.5 0 0 1-3.5 3.5H8.5A3.5 3.5 0 0 1 5 14.5z" />
    <path d="M9 18v2" />
    <path d="M15 18v2" />
  </svg>
);

const SettingsIcon: IconComponent = (props) => (
  <svg {...strokeSvgProps} {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ShieldIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    <svg {...filledSvgProps} {...props}>
      <path d="M12 1.95898L3 4.95898V11.9119C3 14.6493 4.18351 16.6696 5.85876 18.2592C7.5058 19.822 9.65956 20.997 11.6439 22.0675L12 22.2596L12.3561 22.0675C14.3404 20.997 16.4942 19.822 18.1412 18.2592C19.8165 16.6696 21 14.6493 21 11.9119V4.95898L12 1.95898Z" />
    </svg>
  ) : (
    <svg {...strokeSvgProps} {...props}>
      <path d="M20 5.75L12 3L4 5.75V11.9123C4 16.8848 8 19 12 21.1579C16 19 20 16.8848 20 11.9123V5.75Z" />
    </svg>
  );
};

const ServerIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M2 4H22V11H2V4ZM6.5 7.5C6.5 8.05228 6.05228 8.5 5.5 8.5C4.94772 8.5 4.5 8.05228 4.5 7.5C4.5 6.94772 4.94772 6.5 5.5 6.5C6.05228 6.5 6.5 6.94772 6.5 7.5Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M2 13H22V20H2V13ZM6.5 16.5C6.5 17.0523 6.05228 17.5 5.5 17.5C4.94772 17.5 4.5 17.0523 4.5 16.5C4.5 15.9477 4.94772 15.5 5.5 15.5C6.05228 15.5 6.5 15.9477 6.5 16.5Z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props}>
      <path d="M21 12V5H3V12M21 12H3M21 12V19H3V12" />
      <path d="M6.5 14.625C6.98325 14.625 7.375 15.0168 7.375 15.5C7.375 15.9832 6.98325 16.375 6.5 16.375C6.01675 16.375 5.625 15.9832 5.625 15.5C5.625 15.0168 6.01675 14.625 6.5 14.625ZM6.5 7.625C6.98325 7.625 7.375 8.01675 7.375 8.5C7.375 8.98325 6.98325 9.375 6.5 9.375C6.01675 9.375 5.625 8.98325 5.625 8.5C5.625 8.01675 6.01675 7.625 6.5 7.625Z" fill="currentColor" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
};

const PuzzleIcon: IconComponent = (props) => {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return isDark ? (
    // Dark mode - filled
    <svg {...filledSvgProps} {...props}>
      <path d="M17.5 1H13v4.5a3 3 0 1 1-6 0V1H4a3 3 0 0 0-3 3v3h4.5a3 3 0 1 1 0 6H1v4a3 3 0 0 0 3 3h3v-4.5a3 3 0 1 1 6 0V20h4a3 3 0 0 0 3-3v-3h-4.5a3 3 0 1 1 0-6H20V4a3 3 0 0 0-2.5-3z" />
    </svg>
  ) : (
    // Light mode - stroke
    <svg {...strokeSvgProps} {...props}>
      <path d="M16.5 2H13v3.5a2.5 2.5 0 1 1-5 0V2H4.5A2.5 2.5 0 0 0 2 4.5V8h3.5a2.5 2.5 0 1 1 0 5H2v3.5A2.5 2.5 0 0 0 4.5 19H8v-3.5a2.5 2.5 0 1 1 5 0V19h3.5a2.5 2.5 0 0 0 2.5-2.5V13h-3.5a2.5 2.5 0 1 1 0-5H19V4.5A2.5 2.5 0 0 0 16.5 2z" />
    </svg>
  );
};

const SunIcon: IconComponent = (props) => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
    <path d="M13 1H11V4H13V1Z" fill="currentColor" />
    <path d="M13 20H11V23H13V20Z" fill="currentColor" />
    <path d="M20.4841 4.93005L18.3598 7.05427L16.9456 5.64005L19.0698 3.51584L20.4841 4.93005Z" fill="currentColor" />
    <path d="M7.05437 18.36L5.64016 16.9458L3.51594 19.07L4.93016 20.4842L7.05437 18.36Z" fill="currentColor" />
    <path d="M20 11H23V13H20V11Z" fill="currentColor" />
    <path d="M1 11V13H4V11H1Z" fill="currentColor" />
    <path d="M18.3598 16.9458L20.4841 19.07L19.0698 20.4842L16.9456 18.36L18.3598 16.9458Z" fill="currentColor" />
    <path d="M4.93016 3.51584L3.51594 4.93005L5.64016 7.05427L7.05437 5.64005L4.93016 3.51584Z" fill="currentColor" />
    <path d="M7.75736 7.75736C10.1005 5.41421 13.8995 5.41421 16.2426 7.75736C18.5858 10.1005 18.5858 13.8995 16.2426 16.2426C13.8995 18.5858 10.1005 18.5858 7.75736 16.2426C5.41421 13.8995 5.41421 10.1005 7.75736 7.75736Z" fill="currentColor" />
  </svg>
);

const MoonIcon: IconComponent = (props) => (
  <svg {...strokeSvgProps} {...props} strokeLinecap="round">
    <path d="M10.5498 3.08105C10.1951 3.98582 10 4.97071 10 6C10.0001 10.4182 13.5818 14 18 14C19.0291 14 20.0133 13.8038 20.918 13.4492C20.2236 17.7485 16.4972 21.0322 12.002 21.0322C7.01255 21.0322 2.96779 16.9874 2.96777 11.998C2.96777 7.503 6.25084 3.77575 10.5498 3.08105Z" />
  </svg>
);

const ICON_LIBRARIES: Record<string, IconLibrary> = {
  lucide: {
    fileText: FileTextIcon,
    layers: LayersIcon,
    code: CodeIcon,
    bookOpen: BookOpenIcon,
    route: RouteIcon,
    history: HistoryIcon,
    clock: ClockIcon,
    cookbook: CookbookIcon,
    settings: SettingsIcon,
    shield: ShieldIcon,
    server: ServerIcon,
    puzzle: PuzzleIcon,
    sun: SunIcon,
    moon: MoonIcon,
  },
};

const DEFAULT_LIBRARY = "lucide";
const DEFAULT_SIZE = 18;

export type NavIconProps = IconDescriptor & {
  className?: string;
  size?: number;
};

function resolveIcon(descriptor: IconDescriptor): IconComponent | null {
  const libraryName = descriptor.library ?? DEFAULT_LIBRARY;
  const library = ICON_LIBRARIES[libraryName];

  if (!library) {
    return null;
  }

  return library[descriptor.name] ?? null;
}

export function NavIcon({
  className,
  size = DEFAULT_SIZE,
  ...descriptor
}: NavIconProps) {
  const Icon = resolveIcon(descriptor);

  if (!Icon) {
    return null;
  }

  return (
    <Icon
      className={clsx(className)}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    />
  );
}

/**
 * Utility that makes it easier to extend the icon registry in one place.
 * Consumers can swap `DEFAULT_LIBRARY` or append to `ICON_LIBRARIES` to change
 * the icon sources without touching navbar components.
 */
export const iconLibraries = ICON_LIBRARIES;

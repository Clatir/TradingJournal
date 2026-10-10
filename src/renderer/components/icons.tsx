import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base(path: React.ReactNode) {
  return function Icon({ size = 15, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        {...rest}
      >
        {path}
      </svg>
    )
  }
}

export const IconList = base(
  <>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <path d="M2.5 4h.5M2.5 8h.5M2.5 12h.5" />
  </>
)
export const IconPlus = base(<path d="M8 3v10M3 8h10" />)
export const IconGear = base(
  <>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
  </>
)
export const IconSync = base(
  <>
    <path d="M13 6.2A5 5 0 0 0 3.6 5M3 9.8A5 5 0 0 0 12.4 11" />
    <path d="M13.3 3v3.3H10M2.7 13V9.7H6" />
  </>
)
export const IconFolder = base(<path d="M1.8 4.2v8.3h12.4V5.5H8L6.6 3.7H2.3z" />)
export const IconTrash = base(
  <>
    <path d="M2.8 4.2h10.4M6.2 4.2V2.8h3.6v1.4M4 4.2l.7 9h6.6l.7-9" />
  </>
)
export const IconExternal = base(
  <>
    <path d="M9 2.8h4.2V7M13.2 2.8 7.6 8.4" />
    <path d="M11.5 9.5v3.7H2.8V4.5h3.7" />
  </>
)
export const IconImage = base(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <path d="m2.5 11 3.3-3.3 2.4 2.4 1.6-1.6 3.7 3.5" />
    <circle cx="10.6" cy="6" r="1" />
  </>
)
export const IconSearch = base(
  <>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.3 3.3" />
  </>
)
export const IconClose = base(<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />)
export const IconBack = base(<path d="M9.8 3.2 5 8l4.8 4.8" />)
export const IconNext = base(<path d="M6.2 3.2 11 8l-4.8 4.8" />)
export const IconWarn = base(
  <>
    <path d="M8 2.2 14.4 13.4H1.6z" />
    <path d="M8 6.4v3.2M8 11.6v.1" />
  </>
)
export const IconCheck = base(<path d="m3 8.4 3.2 3.2L13 4.6" />)
export const IconKeyboard = base(
  <>
    <rect x="1.5" y="4" width="13" height="8" rx="1" />
    <path d="M4 6.5h.5M6.5 6.5H7M9 6.5h.5M11.5 6.5h.5M4.5 9.5h7" />
  </>
)
export const IconCopy = base(
  <>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1" />
    <path d="M3.5 10.5H2.5V2.5h8v1" />
  </>
)
export const IconLink = base(
  <>
    <path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9" />
    <path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9" />
  </>
)
export const IconPaste = base(
  <>
    <rect x="3" y="3" width="10" height="11" rx="1" />
    <path d="M6 3V2h4v1M5.5 7h5M5.5 9.5h5M5.5 12h3" />
  </>
)
export const IconCalendar = base(
  <>
    <rect x="2" y="3" width="12" height="11" rx="1" />
    <path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" />
    <path d="M5 9h1M7.5 9h1M10 9h1M5 11.5h1M7.5 11.5h1" />
  </>
)
export const IconCalc = base(
  <>
    <rect x="3" y="1.8" width="10" height="12.4" rx="1" />
    <path d="M5.2 4.3h5.6v2.2H5.2zM5.5 9h.5M8 9h.5M10.5 9h.5M5.5 11.5h.5M8 11.5h.5M10.5 11.5h.5" />
  </>
)
export const IconChart = base(
  <>
    <path d="M2 13.5h12" />
    <path d="m3 10.5 3-3.2 2.4 2 4.6-5.3" />
    <path d="M10.6 4h2.4v2.4" />
  </>
)
export const IconBook = base(
  <>
    <path d="M2.5 3.2c2-.8 3.8-.6 5.5.6 1.7-1.2 3.5-1.4 5.5-.6v9.6c-2-.8-3.8-.6-5.5.6-1.7-1.2-3.5-1.4-5.5-.6z" />
    <path d="M8 3.8v9.6" />
  </>
)
export const IconWeek = base(
  <>
    <rect x="2" y="3" width="12" height="10.5" rx="1" />
    <path d="M2 6.2h12M4.6 9h1.4M7.3 9h1.4M10 9h1.4M4.6 11.2h1.4M7.3 11.2h1.4M10 11.2h1.4" />
  </>
)
/** Rising line with a point: payout forecast. */
export const IconForecast = base(
  <>
    <path d="M1.8 13.2h12.4" />
    <path d="M2.5 11 6 7.4l2.6 2.2 4.4-5" />
    <circle cx="13" cy="4.6" r="1.3" />
  </>
)
/** Clock with a back arrow: version history. */
export const IconHistory = base(
  <>
    <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" />
    <path d="M2.2 2.6v2.2h2.2" />
    <path d="M8 5v3.2l2.1 1.4" />
  </>
)
/** Stopwatch: analysis sessions. */
export const IconTimer = base(
  <>
    <circle cx="8" cy="9" r="5" />
    <path d="M8 9V6.4M6.5 1.8h3M12.2 4.4l1-1" />
  </>
)
/** Target: review drills. */
export const IconReport = base(
  <>
    <path d="M3.5 1.8h6.2l2.8 2.8v9.6h-9z" />
    <path d="M9.6 1.8v2.9h2.9" />
    <path d="M5.4 11.6V9.4M7.9 11.6V7.6M10.4 11.6V8.6" />
  </>
)
export const IconTarget = base(
  <>
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="3" />
    <circle cx="8" cy="8" r=".6" />
  </>
)

/** Scanner: a radar sweep. */
export const IconRadar = base(
  <>
    <circle cx="8" cy="8" r="5.8" />
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 8l4.1-4.1" />
  </>
)

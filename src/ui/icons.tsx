import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function make(displayName: string, paths: ReactNode) {
  const Icon = ({ size = 18, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths}
    </svg>
  )
  Icon.displayName = displayName
  return Icon
}

export const Folder = make('Folder', <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />)
export const FolderPlus = make(
  'FolderPlus',
  <>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 10.5v5M9.5 13h5" />
  </>,
)
export const Search = make(
  'Search',
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>,
)
export const Tag = make(
  'Tag',
  <>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
    <circle cx="8" cy="8" r="1" />
  </>,
)
export const Settings = make(
  'Settings',
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
  </>,
)
export const Plus = make('Plus', <path d="M12 5v14M5 12h14" />)
export const ChevronDown = make('ChevronDown', <path d="m6 9 6 6 6-6" />)
export const ChevronRight = make('ChevronRight', <path d="m9 6 6 6-6 6" />)
export const Pin = make('Pin', <path d="M9 3h6l-.75 6 3.75 3H6l3.75-3zM12 12v9" />)
export const Close = make('Close', <path d="M6 6l12 12M18 6 6 18" />)
export const More = make(
  'More',
  <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
)
export const Link = make(
  'Link',
  <>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
  </>,
)
export const Trash = make(
  'Trash',
  <>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </>,
)
export const Grip = make(
  'Grip',
  <>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </>,
)

export const Info = make(
  'Info',
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="0.6" />
  </>,
)
export const Warning = make(
  'Warning',
  <>
    <path d="M10.3 4.2 2.9 17.3A2 2 0 0 0 4.6 20.3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4.2" />
    <circle cx="12" cy="16.8" r="0.6" />
  </>,
)
export const Lightbulb = make(
  'Lightbulb',
  <>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
  </>,
)

export const Bold = make('Bold', <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />)
export const Italic = make('Italic', <path d="M14 5h-4M14 19h-4M15 5l-6 14" />)
export const Underline = make('Underline', <path d="M7 5v6a5 5 0 0 0 10 0V5M5 20h14" />)
export const Strikethrough = make('Strikethrough', <path d="M5 12h14M16.5 7.5A4.5 3 0 0 0 12 5c-2.5 0-4.5 1.2-4.5 3s2 2.5 4.5 3M7.5 16.5A4.5 3 0 0 0 12 19c2.5 0 4.5-1.2 4.5-3" />)
export const CodeInline = make('CodeInline', <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />)
export const TextColor = make(
  'TextColor',
  <>
    <path d="m6 16 6-11 6 11M8.5 12h7" />
    <path d="M5 20h14" />
  </>,
)
export const Highlighter = make(
  'Highlighter',
  <>
    <path d="m14 4 6 6-8 8H8l-4-4v-3z" />
    <path d="M5 21h14" />
  </>,
)

export const TextT = make('TextT', <path d="M5 7V5h14v2M12 5v14M9 19h6" />)
export const Heading1 = make('Heading1', <path d="M4 5v14M4 12h8M12 5v14M17 9l3-2v12" />)
export const Heading2 = make('Heading2', <path d="M4 5v14M4 12h8M12 5v14M16 9a2.5 2.5 0 0 1 5 0c0 2-5 5-5 8h5" />)
export const Heading3 = make('Heading3', <path d="M4 5v14M4 12h8M12 5v14M16 8h4l-2.5 3.5a2.7 2.7 0 1 1-2 4.5" />)
export const ListBullet = make('ListBullet', <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />)
export const ListOrdered = make('ListOrdered', <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 14h3l-3 4h3" />)
export const CheckSquare = make(
  'CheckSquare',
  <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>,
)
export const Quote = make('Quote', <path d="M5 6v12M10 8h9M10 12h9M10 16h6" />)
export const CodeBlock = make(
  'CodeBlock',
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="m10 9-3 3 3 3M14 9l3 3-3 3" />
  </>,
)
export const TableIcon = make(
  'TableIcon',
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18M9 5v14M15 5v14" />
  </>,
)
export const Minus = make('Minus', <path d="M5 12h14" />)
export const ImageIcon = make(
  'ImageIcon',
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m21 16-5-5-9 8" />
  </>,
)
export const Swap = make('Swap', <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />)
export const Paperclip = make(
  'Paperclip',
  <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />,
)
export const FileIcon = make(
  'FileIcon',
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>,
)
export const Download = make(
  'Download',
  <>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 20h14" />
  </>,
)
export const VideoIcon = make(
  'VideoIcon',
  <>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </>,
)

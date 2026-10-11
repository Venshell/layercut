/** Minimal inline SVG icon set (16×16, stroke = currentColor). */

interface IconProps {
  size?: number;
}

function svg(path: React.ReactNode, size = 14): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const EyeIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>,
    size
  );

export const EyeOffIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M3 3l10 10" />
      <path d="M10.6 11a6 6 0 0 1-2.6.6C3.9 11.6 1.5 8 1.5 8a11 11 0 0 1 2.4-2.6M6.5 4.2A6.6 6.6 0 0 1 8 4c4.1 0 6.5 4 6.5 4a11.6 11.6 0 0 1-1.7 2.1" />
    </>,
    size
  );

export const AspectLockIcon = ({ size }: IconProps) =>
  svg(<><path d="M6 5H4a2 2 0 0 0 0 4h2M10 5h2a2 2 0 0 1 0 4h-2M5.5 7h5" /></>, size);

export const OcclusionIcon = ({ size }: IconProps) =>
  svg(<><rect x="2" y="2" width="8" height="8" rx="1" /><path d="M6 12h7V5M9 13h4" /></>, size);

export const LockIcon = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      <path d="M5.5 7V5.2A2.5 2.5 0 0 1 10.5 5.2V7" />
    </>,
    size
  );

export const UnlockIcon = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="3.5" y="7" width="9" height="6" rx="1" />
      <path d="M5.5 7V5.2A2.5 2.5 0 0 1 10.4 4.6" />
    </>,
    size
  );

export const PlusIcon = ({ size }: IconProps) =>
  svg(<path d="M8 3v10M3 8h10" />, size);

export const TrashIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M3 4.5h10M6.5 4.5V3.2A1.2 1.2 0 0 1 7.7 2h.6a1.2 1.2 0 0 1 1.2 1.2v1.3" />
      <path d="M4.5 4.5l.7 8.3a1.2 1.2 0 0 0 1.2 1.1h3.2a1.2 1.2 0 0 0 1.2-1.1l.7-8.3" />
      <path d="M6.7 7v4.5M9.3 7v4.5" />
    </>,
    size
  );

export const CopyIcon = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>,
    size
  );

export const UndoIcon = ({ size }: IconProps) =>
  svg(<path d="M3 6h7a4 4 0 0 1 0 8H6M3 6l3-3M3 6l3 3" />, size);

export const RedoIcon = ({ size }: IconProps) =>
  svg(<path d="M13 6H6a4 4 0 0 0 0 8h4M13 6l-3-3M13 6l-3 3" />, size);

export const ImportIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M8 2v8M5 7l3 3 3-3" />
      <path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11" />
    </>,
    size
  );

export const ExportIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M8 10V2M5 5l3-3 3 3" />
      <path d="M2.5 11v1.5A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5V11" />
    </>,
    size
  );

export const CanvasIcon = ({ size }: IconProps) =>
  svg(
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M2.5 6h11M6 6v7.5" />
    </>,
    size
  );

export const SaveIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M3.5 2.5h7L13.5 5.5v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z" />
      <path d="M5.5 2.5v3.5h5V2.5" />
      <rect x="5" y="9" width="6" height="5" rx="0.5" />
    </>,
    size
  );

export const FolderIcon = ({ size }: IconProps) =>
  svg(
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2h4.5A1.5 1.5 0 0 1 14 6.5v6A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-8z" />,
    size
  );

/* ---------- Drawing tools ---------- */

export const SelectIcon = ({ size }: IconProps) =>
  svg(<path d="M4 2.5l8.5 6.4-3.8.4-1.7 3.7z" />, size);

export const RectIcon = ({ size }: IconProps) =>
  svg(<rect x="2.5" y="4" width="11" height="8" rx="1" />, size);

export const EllipseIcon = ({ size }: IconProps) =>
  svg(<ellipse cx="8" cy="8" rx="5.5" ry="4" />, size);

export const LineIcon = ({ size }: IconProps) =>
  svg(
    <>
      <path d="M3.4 12.6L12.6 3.4" />
      <circle cx="3.4" cy="12.6" r="1.3" />
      <circle cx="12.6" cy="3.4" r="1.3" />
    </>,
    size
  );

export const PolygonIcon = ({ size }: IconProps) =>
  svg(<path d="M8 2.3l4.9 2.9v5.6L8 13.7l-4.9-2.9V5.2z" />, size);

export const StarIcon = ({ size }: IconProps) =>
  svg(<path d="M8 2.4l1.75 3.6 3.95.55-2.85 2.8.67 3.95L8 11.4l-3.52 1.9.67-3.95L2.3 6.55l3.95-.55z" />, size);

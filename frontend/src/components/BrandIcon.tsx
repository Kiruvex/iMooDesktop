/**
 * BrandIcon — inline SVG brand mark for iMoo Desktop.
 *
 * Renders the same blue squircle + white watch glyph used by
 * `assets/icons/app.svg` and `frontend/public/favicon.svg`, but inline so
 * it works without runtime asset fetching (Qt QWebEngineView dev mode,
 * serverless offline use, etc.).
 *
 * The SVG mirrors the master icon's geometry at the same 0 0 512 512 viewBox
 * so it stays pixel-accurate at any size. Default size is 24px (matches the
 * emoji it replaces in Sidebar.tsx); pass `size` for other dimensions.
 */
interface BrandIconProps {
  /** Pixel size (renders square). Defaults to 24. */
  size?: number;
  /** Optional extra class names on the root <svg>. */
  class?: string;
  /** ARIA label for accessibility. Pass null to mark as decorative. */
  label?: string | null;
}

export function BrandIcon({ size = 24, class: cls, label = 'iMoo Desktop' }: BrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={cls}
      role={label === null ? 'presentation' : 'img'}
      aria-label={label === null ? undefined : label}
      aria-hidden={label === null ? 'true' : undefined}
    >
      <defs>
        <linearGradient id="imoo-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#60a5fa" />
          <stop offset="55%" stop-color="#3b82f6" />
          <stop offset="100%" stop-color="#2563eb" />
        </linearGradient>
        <linearGradient id="imoo-gloss" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />
          <stop offset="55%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      {/* Background squircle */}
      <rect width="512" height="512" rx="116" fill="url(#imoo-bg)" />
      <rect width="512" height="512" rx="116" fill="url(#imoo-gloss)" />
      {/* Watch straps */}
      <rect x="200" y="92" width="112" height="68" rx="22" fill="#ffffff" />
      <rect x="200" y="352" width="112" height="68" rx="22" fill="#ffffff" />
      <rect x="220" y="116" width="72" height="6" rx="3" fill="#3b82f6" opacity="0.35" />
      <rect x="220" y="390" width="72" height="6" rx="3" fill="#3b82f6" opacity="0.35" />
      {/* Watch case + dial */}
      <circle cx="256" cy="256" r="128" fill="#ffffff" />
      <circle cx="256" cy="256" r="104" fill="#1e3a8a" />
      {/* Tick marks 12/3/6/9 */}
      <rect x="252" y="168" width="8" height="20" rx="2" fill="#ffffff" />
      <rect x="252" y="324" width="8" height="20" rx="2" fill="#ffffff" />
      <rect x="168" y="252" width="20" height="8" rx="2" fill="#ffffff" />
      <rect x="324" y="252" width="20" height="8" rx="2" fill="#ffffff" />
      {/* Hands at 10:10 + center pin */}
      <line x1="256" y1="256" x2="206" y2="216" stroke="#ffffff" stroke-width="14" stroke-linecap="round" />
      <line x1="256" y1="256" x2="316" y2="226" stroke="#ffffff" stroke-width="12" stroke-linecap="round" />
      <circle cx="256" cy="256" r="10" fill="#ffffff" />
      <circle cx="256" cy="256" r="4" fill="#1e3a8a" />
    </svg>
  );
}

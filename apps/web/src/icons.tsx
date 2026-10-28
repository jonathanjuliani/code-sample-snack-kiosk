type IconProps = { size?: number; className?: string };

export function WarnIcon({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3 2 21h20L12 3Z" />
      <path d="M12 10v5M12 18v.5" strokeLinecap="round" />
    </svg>
  );
}

export function ErrorIcon({ size = 48, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="m8.5 8.5 7 7M15.5 8.5l-7 7" />
    </svg>
  );
}

export function OkIcon({ size = 96, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m7.5 12.5 3 3 6-6.5" />
    </svg>
  );
}

export function ArrowIcon({ size = 96, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function TrashIcon({ size = 26 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}

const GLYPH: Record<string, string> = {
  snacks: 'M6 3h12l-2 18H8L6 3Z',
  drinks: 'M7 3h10l-1.5 18h-7L7 3ZM6 8h12',
  hot: 'M3 9h18v7H3z',
  sweets: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z',
};

export function CategoryGlyph({ categoryId }: { categoryId: string }) {
  const d = GLYPH[categoryId] ?? GLYPH.snacks;
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

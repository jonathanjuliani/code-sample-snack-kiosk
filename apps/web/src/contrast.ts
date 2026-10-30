function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** Contrast of white text on a #RRGGBB fill. Null when the color is not 6-digit hex. */
export function whiteOnHexRatio(hex: string): number | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  const raw = match?.[1];
  if (!raw) return null;
  const red = channel(Number.parseInt(raw.slice(0, 2), 16));
  const green = channel(Number.parseInt(raw.slice(2, 4), 16));
  const blue = channel(Number.parseInt(raw.slice(4, 6), 16));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return (1 + 0.05) / (luminance + 0.05);
}

export function accentAcceptsWhiteText(hex: string): boolean {
  const ratio = whiteOnHexRatio(hex);
  return ratio !== null && ratio >= 4.5;
}

export function applyVenueAccent(accent: string): void {
  if (typeof document === 'undefined') return;
  if (!accentAcceptsWhiteText(accent)) {
    console.warn(`Venue accent ${accent} is too light for white text. Keeping the default.`);
    return;
  }
  document.documentElement.style.setProperty('--accent', accent);
}

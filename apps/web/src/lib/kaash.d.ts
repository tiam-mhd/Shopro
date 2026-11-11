export const KAASH_PLACEHOLDER: string;
export function kaashScreenForPath(pathname: string): string;
export function normalizeKaashText(text: string): string;
export function kaashCharacterCount(text: string): number;
export function paginateKaashStory(text: string, widthPx: number, fontSizePx: number, maxLines?: number): string[];

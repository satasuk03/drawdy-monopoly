// Public art API: pure functions returning SVG strings (no DOM, deterministic).

import type { BoardDef } from "../boards/types";
import { tokenSvgFor } from "./tokens";

export { boardSvg } from "./board";
export { boardPreviewSvg, tileCardSvg } from "./cards";
export { diceFaceSvg, diceShadowSvg } from "./dice";
export { turnRingSvg } from "./marker";
export { houseSvg, hotelSvg } from "./buildings";
export { svgDataUrl } from "./util";
export { ICON_KEYS } from "./icons";

export function tokenSvg(board: BoardDef, tokenId: string, color: string): string {
    return tokenSvgFor(board.artTheme, tokenId, color);
}

/** 24x24 toolbar icon: a die with a top-hat flourish. Fixed violet that reads on light and dark. */
export function actionButtonSvg(): string {
    const c = "#8a63ff";
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">` +
        `<rect x="3" y="8" width="14" height="14" rx="3.5"/>` +
        `<circle cx="7.5" cy="12.5" r="1" fill="${c}" stroke="none"/><circle cx="12.5" cy="17.5" r="1" fill="${c}" stroke="none"/><circle cx="10" cy="15" r="1" fill="${c}" stroke="none"/>` +
        `<path d="M14 6.500L18 2l4 4.500-4.500 4M16.500 4.500l3 3"/>` +
        `</svg>`
    ).replace("6.500", "6.5").replace("4.500", "4.5");
}

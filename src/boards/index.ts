import type { BoardDef } from "./types";
import { CLASSIC } from "./classic";
import { THAILAND } from "./thailand";
import { SPACE } from "./space";
import { FANTASY } from "./fantasy";

export const BOARDS: BoardDef[] = [CLASSIC, THAILAND, SPACE, FANTASY];

export function getBoard(id: string): BoardDef | undefined {
    return BOARDS.find((b) => b.id === id);
}

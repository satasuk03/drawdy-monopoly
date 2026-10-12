// Deck mechanics. A deck is a circular list of card indices with a draw
// pointer. Jail-free cards leave the list while a player holds them and go
// back in at the bottom (just before the pointer) when used or surrendered.

import type { BoardDef, CardDef } from "../boards/types";
import { shuffle } from "./rng";
import type { Deck, GameState } from "./types";

export type DeckName = "chance" | "chest";

export function newDeck(s: GameState, cards: CardDef[]): Deck {
    return { order: shuffle(s, cards.map((_, i) => i)), next: 0 };
}

/** Draw the next card index (or -1 for an empty deck). Jail-free cards are removed from the deck. */
export function drawCard(board: BoardDef, s: GameState, name: DeckName): number {
    const deck = s.decks[name];
    if (deck.order.length === 0) return -1;
    if (deck.next >= deck.order.length) deck.next = 0;
    const idx = deck.order[deck.next];
    if (board[name][idx]?.effect.kind === "jail-free") {
        deck.order.splice(deck.next, 1);
        if (deck.next >= deck.order.length) deck.next = 0;
    } else {
        deck.next = (deck.next + 1) % deck.order.length;
    }
    return idx;
}

/** Put one held jail-free card back at the bottom of its deck. */
export function returnJailCard(board: BoardDef, s: GameState, name: DeckName): void {
    const deck = s.decks[name];
    const idx = board[name].findIndex((c, i) => c.effect.kind === "jail-free" && !deck.order.includes(i));
    if (idx < 0) return;
    // Inserting at the pointer and stepping past it makes it the last card drawn.
    deck.order.splice(deck.next, 0, idx);
    deck.next = (deck.next + 1) % deck.order.length;
}

/** Which deck to spend a held jail card from (chance first). */
export function heldJailDeck(s: GameState, seat: number): DeckName | null {
    const c = s.players[seat].jailCards;
    return c.chance > 0 ? "chance" : c.chest > 0 ? "chest" : null;
}

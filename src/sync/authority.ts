// Pure authority logic: who should be authority, which intents to apply next,
// and how applying them changes the envelope. No Drawdy, no clock (time is a
// parameter), no engine import (the engine function is a parameter), so every
// client computes the same answers from the same inputs and it's all testable.

import type { BoardDef } from "../boards/types";
import type { Action, Actor, ApplyResult, GameState } from "../engine/types";
import type { GameEnvelope, Intent, IntentRecord } from "./envelope";

/** The authority must be absent this long before anyone takes over. */
export const FAILOVER_MS = 4000;

export type ApplyActionFn = (board: BoardDef, state: GameState, action: Action, actor: Actor) => ApplyResult;

/**
 * Seat-order candidates for authority: userIds of non-bankrupt seats in seat
 * order, then the creator, then bankrupt seats (they can still keep the scene
 * alive). Deduplicated; hot-seat users appear once at their first seat.
 */
export function authorityCandidates(state: GameState): string[] {
    const out: string[] = [];
    const push = (u: string) => {
        if (u && !out.includes(u)) out.push(u);
    };
    for (const p of state.players) if (!p.bankrupt) push(p.userId);
    push(state.creatorUserId);
    for (const p of state.players) if (p.bankrupt) push(p.userId);
    return out;
}

/**
 * Who should be authority right now.
 *
 * - The current authority keeps the job while present, and for FAILOVER_MS
 *   after it was first seen absent (`absentSinceMs`; null = not known absent).
 * - After that, the first *present* candidate in seat order takes over.
 *   Every client sees (nearly) the same presence list, so they all compute
 *   the same successor and claims practically never race; when they do, the
 *   version/tie-break rules in the session settle it.
 * - If no candidate is present, nothing changes (a pure spectator never
 *   becomes authority).
 */
export function electAuthority(
    envelope: GameEnvelope,
    presentUserIds: readonly string[],
    absentSinceMs: number | null,
    nowMs: number
): string {
    const current = envelope.authorityUserId;
    const present = new Set(presentUserIds);
    if (present.has(current)) return current;
    if (absentSinceMs === null || nowMs - absentSinceMs < FAILOVER_MS) return current;
    for (const u of authorityCandidates(envelope.state)) {
        if (u !== current && present.has(u)) return u;
    }
    return current;
}

export type PendingIntent = { userId: string; intent: Intent };

/**
 * Intents not yet acked, in application order.
 *
 * Within a user, strictly by seq (the user's own causal order). Across users,
 * a k-way merge by the writer's timestamp `t` (ties and missing `t` broken by
 * userId), which approximates "who clicked first" without ever reordering a
 * single user's actions.
 */
export function pendingIntents(envelope: GameEnvelope, intentRecords: Iterable<IntentRecord>): PendingIntent[] {
    const queues: { userId: string; items: Intent[] }[] = [];
    for (const rec of intentRecords) {
        if (rec.gameId !== envelope.state.gameId) continue;
        const acked = envelope.acks[rec.userId] ?? 0;
        const items = rec.intents.filter((i) => i.seq > acked).sort((a, b) => a.seq - b.seq);
        if (items.length > 0) queues.push({ userId: rec.userId, items });
    }
    queues.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    const out: PendingIntent[] = [];
    const heads = queues.map(() => 0);
    for (;;) {
        let best = -1;
        let bestT = Infinity;
        for (let q = 0; q < queues.length; q++) {
            const it = queues[q]!.items[heads[q]!];
            if (!it) continue;
            const t = it.t ?? Infinity;
            if (best === -1 || t < bestT) {
                best = q;
                bestT = t;
            }
        }
        if (best === -1) break;
        const q = queues[best]!;
        out.push({ userId: q.userId, intent: q.items[heads[best]!]! });
        heads[best]!++;
    }
    return out;
}

/** The actor for an action from `userId`, and the action with any identity fields forced to that user. */
export function actorFor(state: GameState, userId: string, action: Action): { actor: Actor; action: Action } {
    const actor: Actor = { userId, isCreator: userId === state.creatorUserId };
    // A join always seats the *writer*; nobody can seat someone else.
    const fixed: Action = action.type === "join" ? { ...action, userId } : action;
    return { actor, action: fixed };
}

export type ApplyIntentsResult = {
    envelope: GameEnvelope;
    applied: number;
    rejected: { userId: string; seq: number; message: string }[];
};

/**
 * Apply intents (as returned by pendingIntents) to the envelope. Each intent
 * is acked whether it succeeded or not; a rejection is recorded in
 * `errors[userId]` so the sender can show it. Returns the input envelope
 * unchanged (same object) when there was nothing to apply, otherwise a new
 * envelope with version + 1. Never throws: an engine exception counts as a
 * rejection.
 */
export function applyIntents(
    board: BoardDef,
    envelope: GameEnvelope,
    intents: readonly PendingIntent[],
    applyAction: ApplyActionFn
): ApplyIntentsResult {
    let state = envelope.state;
    const acks = { ...envelope.acks };
    const errors = { ...envelope.errors };
    let applied = 0;
    const rejected: ApplyIntentsResult["rejected"] = [];
    let touched = false;
    for (const { userId, intent } of intents) {
        if (intent.seq <= (acks[userId] ?? 0)) continue; // already handled (duplicate in input)
        touched = true;
        acks[userId] = intent.seq;
        const { actor, action } = actorFor(state, userId, intent.action);
        let res: ApplyResult;
        try {
            res = applyAction(board, state, action, actor);
        } catch (e) {
            res = { ok: false, error: `Engine error: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (res.ok) {
            state = res.state;
            applied++;
        } else {
            errors[userId] = { seq: intent.seq, message: res.error };
            rejected.push({ userId, seq: intent.seq, message: res.error });
        }
    }
    if (!touched) return { envelope, applied: 0, rejected };
    return {
        envelope: { ...envelope, version: envelope.version + 1, acks, errors, state },
        applied,
        rejected,
    };
}

/** The authority's own action: applied directly, no intent round-trip. */
export function applyLocal(
    board: BoardDef,
    envelope: GameEnvelope,
    userId: string,
    rawAction: Action,
    applyAction: ApplyActionFn
): { ok: true; envelope: GameEnvelope } | { ok: false; error: string } {
    const { actor, action } = actorFor(envelope.state, userId, rawAction);
    let res: ApplyResult;
    try {
        res = applyAction(board, envelope.state, action, actor);
    } catch (e) {
        return { ok: false, error: `Engine error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, envelope: { ...envelope, version: envelope.version + 1, state: res.state } };
}

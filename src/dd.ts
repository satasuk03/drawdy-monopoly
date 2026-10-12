// Tiny typed helper around the driver's issueCommand.
//
//   await cmd("command:camera:get-viewport-rect")          -> { rect }
//   await cmd("command:scene:add-drawdy-elements", { elements })
//
// Every Drawdy command resolves with either `value` or `error`; cmd() returns
// the value and throws a DdError (which keeps the protocol `error.type` and
// `body`) otherwise, so call sites can use plain try/catch and branch on
// `e.type` ("unauthorized", "bad-argument", "not-found", "runtime").

import type {
    DriverCommand,
    DriverCommandIssuer,
    DriverCommandRequest,
    DriverManifest,
    ModuleStyling,
    ProtocolCommandError,
} from "@drawdy/driver-protocol";

export type CommandType = DriverCommandRequest["type"];

type CommandOf<T extends CommandType> = Extract<DriverCommand, { type: T }>;

/** The `req` payload of command T, or undefined for commands without one. */
export type ReqOf<T extends CommandType> = CommandOf<T> extends { req: infer R } ? R : undefined;

/** The success value of command T. */
export type ValueOf<T extends CommandType> = Extract<CommandOf<T>["res"], { error?: never }>["value"];

type ReqArgs<T extends CommandType> = [ReqOf<T>] extends [undefined] ? [] : [req: ReqOf<T>];

export type DdErrorType = ProtocolCommandError["type"] | "not-initialized";

export class DdError extends Error {
    readonly type: DdErrorType;
    readonly body: Record<string, unknown> | undefined;
    readonly command: string;

    constructor(command: string, type: DdErrorType, message?: string, body?: Record<string, unknown>) {
        super(`${command}: ${type}${message ? ` — ${message}` : ""}`);
        this.name = "DdError";
        this.type = type;
        this.body = body;
        this.command = command;
    }
}

export function isDdError(e: unknown, type?: DdErrorType): e is DdError {
    return e instanceof DdError && (type === undefined || e.type === type);
}

type DdContext = {
    issueCommand: DriverCommandIssuer;
    manifest: DriverManifest;
    styling: ModuleStyling;
    generateId: () => string;
};

let ctx: DdContext | null = null;
let requestSeq = 0;

export function init(c: DdContext): void {
    ctx = c;
}

export function driverId(): string {
    return ctx?.manifest.driverId ?? "unknown";
}

export function generateId(): string {
    if (ctx) return ctx.generateId();
    return `id${Date.now().toString(36)}${(requestSeq++).toString(36)}`;
}

/** Issue a command; resolves to its value, throws DdError on a protocol error. */
export async function cmd<T extends CommandType>(type: T, ...args: ReqArgs<T>): Promise<ValueOf<T>> {
    if (!ctx) throw new DdError(type, "not-initialized");
    const request = {
        type,
        driverId: ctx.manifest.driverId,
        requestId: `bt-${requestSeq++}`,
        ...(args.length > 0 ? { req: args[0] } : {}),
    } as unknown as DriverCommandRequest;
    let response: { res: { error?: ProtocolCommandError; value?: unknown } };
    try {
        response = (await ctx.issueCommand(request)) as typeof response;
    } catch (e) {
        // issueCommand itself should never reject, but never trust that.
        throw new DdError(type, "runtime", e instanceof Error ? e.message : String(e));
    }
    const err = response?.res?.error;
    if (err) throw new DdError(type, err.type, err.message, err.body);
    return response?.res?.value as ValueOf<T>;
}

/** Like cmd() but returns null instead of throwing. */
export async function tryCmd<T extends CommandType>(type: T, ...args: ReqArgs<T>): Promise<ValueOf<T> | null> {
    try {
        return await cmd(type, ...args);
    } catch (e) {
        logError(e);
        return null;
    }
}

/**
 * Subscribe; resolves to the subscription id, or null when the subscription
 * failed (typically "unauthorized" because a permission was denied).
 */
export async function trySub<T extends CommandType & `subscription:${string}`>(
    type: T,
    ...args: ReqArgs<T>
): Promise<string | null> {
    try {
        const v = (await cmd(type, ...args)) as { subscriptionId?: string } | undefined;
        return v?.subscriptionId ?? null;
    } catch (e) {
        if (!isDdError(e, "unauthorized")) logError(e);
        return null;
    }
}

export function logError(e: unknown, context?: string): void {
    const prefix = context ? `[board-tycoon] ${context}:` : "[board-tycoon]";
    try {
        console.warn(prefix, e instanceof Error ? e.message : e);
    } catch {
        // console may be unavailable in exotic hosts; nothing else to do.
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { Scenario } from "./types";

// mobius-mcp's capture-core only patches console.log/info/warn/error (see
// packages/capture-core/src/index.ts CONSOLE_METHODS) — console.debug/table/group/etc
// pass through unpatched, so scenarios here stick to the four captured methods and vary
// the *payload shape* instead, since that's what stresses safeStringify/redaction.
export const consoleScenarios: Scenario[] = [
  { id: "console-log-string", label: "log: plain string", description: "console.log('...')", run: () => console.log("smoke test: plain string message") },
  { id: "console-info-string", label: "info: plain string", description: "console.info('...')", run: () => console.info("smoke test: informational message") },
  { id: "console-warn-string", label: "warn: plain string", description: "console.warn('...')", run: () => console.warn("smoke test: something looks off") },
  { id: "console-error-string", label: "error: plain string", description: "console.error('...')", run: () => console.error("smoke test: explicit console.error call") },

  {
    id: "console-log-multi-arg",
    label: "log: multiple args",
    description: "console.log('a', 1, true, null)",
    run: () => console.log("smoke test: multi-arg", 42, true, null, undefined),
  },
  {
    id: "console-log-object",
    label: "log: nested object",
    description: "console.log({ ...nested })",
    run: () => console.log("smoke test: object payload", { user: { id: 1, name: "Ada", roles: ["admin", "editor"] }, ts: Date.now() }),
  },
  {
    id: "console-log-array",
    label: "log: array of objects",
    description: "console.log([{...}, {...}])",
    run: () => console.log("smoke test: array payload", [{ id: 1 }, { id: 2 }, { id: 3 }]),
  },
  {
    id: "console-error-error-object",
    label: "error: Error object",
    description: "console.error(new Error(...))",
    run: () => console.error("smoke test: logged Error instance", new Error("boom (logged, not thrown)")),
  },
  {
    id: "console-log-circular",
    label: "log: circular reference",
    description: "an object referencing itself — exercises safeStringify's cycle guard",
    run: () => {
      const obj: Record<string, unknown> = { name: "circular" };
      obj.self = obj;
      console.log("smoke test: circular object", obj);
    },
  },
  {
    id: "console-log-bigint",
    label: "log: BigInt",
    description: "console.log(9007199254740993n)",
    run: () => console.log("smoke test: bigint value", 9007199254740993n),
  },
  {
    id: "console-log-long-string",
    label: "log: very long string",
    description: "a 5000-character string, exercises message truncation",
    run: () => console.log("smoke test: long string", "x".repeat(5000)),
  },
  {
    id: "console-log-pii-like",
    label: "log: email + JWT-shaped string",
    description: "for testing maskEmails/maskJwts redaction options in the extension's privacy settings",
    run: () =>
      console.log(
        "smoke test: contact user@example.com, token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      ),
  },
  {
    id: "console-log-rapid",
    label: "log: 20 rapid-fire logs",
    description: "burst of 20 console.log calls in a tight loop, exercises buffering/ordering",
    run: () => {
      for (let i = 0; i < 20; i++) console.log(`smoke test: rapid log ${i + 1}/20`);
    },
  },
];

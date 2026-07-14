import type { Scenario } from "./types";

class CustomAppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomAppError";
  }
}

export const errorScenarios: Scenario[] = [
  {
    id: "error-throw-sync",
    label: "throw: synchronous",
    description: "throws immediately in the click handler — window.onerror",
    run: () => {
      throw new Error("smoke test: synchronous uncaught error");
    },
  },
  {
    id: "error-throw-settimeout",
    label: "throw: inside setTimeout",
    description: "throws on a macrotask — still an uncaught window.onerror, not a promise rejection",
    run: () => {
      setTimeout(() => {
        throw new Error("smoke test: uncaught error inside setTimeout");
      }, 0);
    },
  },
  {
    id: "error-throw-custom-class",
    label: "throw: custom Error subclass",
    description: "throws a named Error subclass, exercises stack/name capture",
    run: () => {
      throw new CustomAppError("smoke test: custom error subclass");
    },
  },
  {
    id: "error-null-access",
    label: "throw: TypeError (null property access)",
    description: "a realistic runtime bug, not a hand-thrown Error",
    run: () => {
      const maybe: { deep?: { value: string } } | null = null;
      // @ts-expect-error intentional runtime error for the smoke test
      console.log(maybe.deep.value);
    },
  },
  {
    id: "error-unhandled-rejection",
    label: "reject: unhandled promise rejection",
    description: "Promise.reject with no .catch — unhandledrejection event",
    run: () => {
      Promise.reject(new Error("smoke test: unhandled rejection"));
    },
  },
  {
    id: "error-unhandled-rejection-async",
    label: "reject: async function throws",
    description: "an async function that throws without being awaited/caught by the caller",
    run: () => {
      const fail = async () => {
        throw new Error("smoke test: async function rejection");
      };
      void fail();
    },
  },
  {
    id: "error-unhandled-rejection-string",
    label: "reject: non-Error rejection reason",
    description: "rejects with a plain string instead of an Error instance",
    run: () => {
      Promise.reject("smoke test: rejected with a plain string reason");
    },
  },
];

import type { Scenario } from "./types";

export const networkScenarios: Scenario[] = [
  { id: "network-fetch-ok", label: "fetch: 200 OK", description: "GET https://httpbin.org/get", run: () => void fetch("https://httpbin.org/get") },
  {
    id: "network-fetch-404",
    label: "fetch: 404 Not Found",
    description: "GET https://httpbin.org/status/404",
    run: () => void fetch("https://httpbin.org/status/404"),
  },
  {
    id: "network-fetch-500",
    label: "fetch: 500 Server Error",
    description: "GET https://httpbin.org/status/500",
    run: () => void fetch("https://httpbin.org/status/500"),
  },
  {
    id: "network-fetch-post",
    label: "fetch: POST with JSON body",
    description: "POST https://httpbin.org/post with a JSON payload and custom header",
    run: () =>
      void fetch("https://httpbin.org/post", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Smoke-Test": "1" },
        body: JSON.stringify({ hello: "world" }),
      }),
  },
  {
    id: "network-fetch-slow",
    label: "fetch: slow (3s delay)",
    description: "GET https://httpbin.org/delay/3 — exercises durationMs tracking",
    run: () => void fetch("https://httpbin.org/delay/3"),
  },
  {
    id: "network-fetch-network-error",
    label: "fetch: DNS/network failure",
    description: "request to a domain that can't resolve — network.fetch event with an `error` field, no `status`",
    run: () => void fetch("https://this-domain-does-not-exist.invalid/").catch(() => {}),
  },
  {
    id: "network-xhr-ok",
    label: "XHR: 200 OK",
    description: "XMLHttpRequest GET, exercises the XHR patch path separately from fetch",
    run: () => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://httpbin.org/get");
      xhr.send();
    },
  },
  {
    id: "network-xhr-404",
    label: "XHR: 404 Not Found",
    description: "XMLHttpRequest GET against a 404 endpoint",
    run: () => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "https://httpbin.org/status/404");
      xhr.send();
    },
  },
];

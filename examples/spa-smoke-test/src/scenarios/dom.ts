import type { Scenario } from "./types";

// DOM mutation capture (patchDomMutations) is only started during a debug session
// (start_debug_session with "dom" in `capture`) — it's not always-on. These scenarios
// mutate #dom-scratch, a zone dedicated to this so it doesn't get confused with React's
// own re-renders elsewhere on the page.
function scratch(): HTMLElement {
  const el = document.getElementById("dom-scratch");
  if (!el) throw new Error("smoke test: #dom-scratch not found — is DomScratch mounted?");
  return el;
}

export const domScenarios: Scenario[] = [
  {
    id: "dom-add-node",
    label: "DOM: append a node",
    description: "childList mutation — adds a <p> to #dom-scratch",
    run: () => {
      const p = document.createElement("p");
      p.textContent = `smoke test: appended at ${new Date().toLocaleTimeString()}`;
      scratch().appendChild(p);
    },
  },
  {
    id: "dom-remove-node",
    label: "DOM: remove last node",
    description: "childList mutation — removes the last child of #dom-scratch",
    run: () => {
      const el = scratch();
      if (el.lastElementChild) el.removeChild(el.lastElementChild);
    },
  },
  {
    id: "dom-attribute-change",
    label: "DOM: toggle an attribute",
    description: "attributes mutation — flips data-smoke-state on #dom-scratch",
    run: () => {
      const el = scratch();
      el.dataset.smokeState = el.dataset.smokeState === "on" ? "off" : "on";
    },
  },
  {
    id: "dom-text-change",
    label: "DOM: mutate text content",
    description: "characterData mutation — rewrites the text of the first child",
    run: () => {
      const el = scratch();
      if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
        el.firstChild.textContent = `smoke test: text mutated at ${new Date().toLocaleTimeString()}`;
      } else {
        const text = document.createTextNode(`smoke test: text node ${Date.now()}`);
        el.insertBefore(text, el.firstChild);
      }
    },
  },
];

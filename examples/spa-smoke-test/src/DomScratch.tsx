import { useEffect, useRef } from "react";

// A plain (non-React-managed-children) DOM node that the DOM mutation scenarios
// mutate directly via the DOM API — kept outside React's own render cycle so
// React's reconciliation doesn't fight with or mask the mutations we're testing.
export function DomScratch() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.id = "dom-scratch";
    containerRef.current?.appendChild(el);
    return () => el.remove();
  }, []);

  return (
    <div>
      <h3>DOM scratch zone</h3>
      <p>DOM mutation scenarios (below, under "DOM mutations") target the box here. Also auto-mutates every 5s so passive mutation capture has something to see.</p>
      <div ref={containerRef} className="dom-scratch-box" />
    </div>
  );
}

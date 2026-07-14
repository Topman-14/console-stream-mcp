import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Logs } from "./modules/logs/index.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Logs />
  </StrictMode>,
);

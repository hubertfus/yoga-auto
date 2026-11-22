import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@yoga-auto/glass-ui/styles.css";
import "./shell/global.css";
import { client } from "./core/client.ts";
import { App } from "./shell/App.tsx";

// Auto-rejestracja features: każdy src/features/<nazwa>/index.ts(x) rejestruje ekrany/widgety w core/registry.
import.meta.glob("./features/*/index.{ts,tsx}", { eager: true });

client.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

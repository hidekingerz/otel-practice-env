import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// OTel 計装を最初に初期化（副作用として fetch / document-load を計装）
import "./otel/tracing";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

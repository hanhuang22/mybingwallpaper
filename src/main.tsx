import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { preventBrowserContextMenu } from "./lib/contextMenu";
import "./styles.css";

document.addEventListener("contextmenu", preventBrowserContextMenu, { capture: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

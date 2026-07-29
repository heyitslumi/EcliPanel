import { createRoot } from "react-dom/client";
import { createElement } from "react";
import PageShell from "./components/PageShell";

const el = document.getElementById("root");
if (el) {
  const raw = el.getAttribute("data-props") || "{}";
  const props = JSON.parse(raw);
  const root = createRoot(el);
  root.render(createElement(PageShell, props));
}
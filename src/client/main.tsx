import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { StatsPage } from "./components/StatsPage";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");

// Under `bun --hot` this module re-runs on every hot reload; reuse the
// existing React root instead of calling createRoot() on it twice.
const globalForRoot = globalThis as { reactRoot?: Root };
const root = (globalForRoot.reactRoot ??= createRoot(container));

// /stats is the one non-SPA route: a public page that needs no session.
root.render(window.location.pathname === "/stats" ? <StatsPage /> : <App />);

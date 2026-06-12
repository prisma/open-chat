import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { StatsPage } from "./components/StatsPage";
import { TourPage } from "./components/TourPage";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing root element");

// Under `bun --hot` this module re-runs on every hot reload; reuse the
// existing React root instead of calling createRoot() on it twice.
const globalForRoot = globalThis as { reactRoot?: Root };
const root = (globalForRoot.reactRoot ??= createRoot(container));

// /stats and /tour are the non-SPA routes: public pages that need no session.
const page =
  window.location.pathname === "/stats" ? (
    <StatsPage />
  ) : window.location.pathname === "/tour" ? (
    <TourPage />
  ) : (
    <App />
  );
root.render(page);

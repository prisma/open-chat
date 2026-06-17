// Small presentation helpers shared across the UI: class-name joining,
// money/token/time formatting, clipboard copy with a legacy fallback, and
// the date grouping behind the sidebar's chat list.
import type { ChatDto } from "../shared/contracts";

export function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : timeFormat.format(date);
}

export function formatDay(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function modelShortName(modelId: string) {
  return modelId.split("/").pop() ?? modelId;
}

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  amazon: "Amazon",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  google: "Google",
  meta: "Meta",
  microsoft: "Microsoft",
  mistralai: "Mistral",
  moonshotai: "Moonshot",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  "qwen": "Qwen",
  "x-ai": "xAI",
  zyphra: "Zyphra",
};

const PROVIDER_GLYPHS: Record<string, string> = {
  anthropic: "✺",
  amazon: "↗",
  cohere: "◌",
  deepseek: "◈",
  google: "✦",
  meta: "∞",
  microsoft: "⊞",
  mistralai: "⟠",
  moonshotai: "🌙",
  nvidia: "◢",
  openai: "◎",
  qwen: "◍",
  "x-ai": "𝕏",
  zyphra: "🤗",
};

export function modelProviderSlug(modelId: string) {
  return modelId.split("/")[0] ?? "";
}

export function modelProviderName(modelId: string) {
  const slug = modelProviderSlug(modelId);
  return (
    PROVIDER_NAMES[slug] ??
    slug
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function modelProviderGlyph(modelId: string) {
  const slug = modelProviderSlug(modelId);
  return PROVIDER_GLYPHS[slug] ?? (modelProviderName(modelId)[0] ?? "?");
}

export function formatUsd(microUsd: number, decimals = 2) {
  return `$${(microUsd / 1_000_000).toFixed(decimals)}`;
}

export function formatCost(microUsd: number) {
  const usd = microUsd / 1_000_000;
  if (usd >= 0.1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function fallbackCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API unavailable or denied; try the legacy path.
  }
  return fallbackCopy(text);
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase();
}

export function groupChats(chats: Array<ChatDto>) {
  const groups: Array<{ label: string; chats: Array<ChatDto> }> = [];
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = 86_400_000;

  for (const chat of chats) {
    const time = new Date(chat.updatedAt).getTime();
    const label =
      time >= today
        ? "Today"
        : time >= today - day
          ? "Yesterday"
          : time >= today - 6 * day
            ? "Previous 7 days"
            : "Older";
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.chats.push(chat);
    } else {
      groups.push({ label, chats: [chat] });
    }
  }

  return groups;
}

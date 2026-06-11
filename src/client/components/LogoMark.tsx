// The Open Chat logo glyph, inlined as SVG so it inherits currentColor
// wherever it appears: the sidebar wordmark, the auth panel, and the
// empty-transcript state.

// App mark: a chat bubble with a lightning bolt knocked out of it — the
// "live spark" inside a durable conversation. Filled so it stays legible
// at the 13px sidebar size where stroked icons turn to mush.
export function LogoMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM13.2 4.8 8.4 11.1h2.9l-.5 4.1 4.8-6.3h-2.9z"
      />
    </svg>
  );
}

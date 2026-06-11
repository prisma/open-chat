// Hand-off from the static boot overlay that index.html paints before
// React loads. Views call dismissBootScreen once they have something
// worth showing, and the overlay retires itself.

// Dismiss the boot overlay from index.html: fly its logo onto the in-app
// logo glyph (a FLIP transition) while the backdrop dissolves, so the boot
// screen and the app read as one continuous scene. Falls back to a plain
// fade when no glyph is on screen (e.g. mobile with the sidebar closed) or
// the user prefers reduced motion. Idempotent — the overlay is removed
// from the DOM afterwards.
export function dismissBootScreen() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  const logo = boot.querySelector<HTMLElement>(".boot-logo");

  const fade = () => {
    boot.style.transition = "opacity 0.2s ease";
    boot.style.opacity = "0";
    setTimeout(() => boot.remove(), 220);
  };

  const target = [
    ...document.querySelectorAll<HTMLElement>(".wordmark-glyph"),
  ].find((el) => {
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.left >= 0 &&
      rect.top >= 0 &&
      rect.right <= window.innerWidth &&
      rect.bottom <= window.innerHeight
    );
  });

  if (
    !logo ||
    !target ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    fade();
    return;
  }

  // Freeze the pulse mid-frame so the flight starts from the exact pixels
  // currently on screen, then transition to the target glyph's position
  // and size. Centers are used so the in-flight scale doesn't skew the
  // translation; 44 is the logo's untransformed size from index.html.
  const style = getComputedStyle(logo);
  logo.style.animation = "none";
  logo.style.opacity = style.opacity;
  logo.style.transform = style.transform === "none" ? "" : style.transform;

  const from = logo.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  target.style.visibility = "hidden";

  void logo.offsetWidth;
  logo.style.transition =
    "transform 0.5s cubic-bezier(0.2, 0.9, 0.25, 1), opacity 0.2s ease";
  logo.style.opacity = "1";
  logo.style.transform = `translate(${dx}px, ${dy}px) scale(${to.width / 44})`;
  boot.classList.add("done");

  setTimeout(() => {
    target.style.visibility = "";
    boot.remove();
  }, 520);
}

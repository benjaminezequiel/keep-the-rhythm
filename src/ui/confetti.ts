// Obsidian's own theme accent colors, so confetti stays on-theme in any vault.
export const CONFETTI_COLORS = [
	"var(--color-red)",
	"var(--color-orange)",
	"var(--color-yellow)",
	"var(--color-green)",
	"var(--color-cyan)",
	"var(--color-blue)",
	"var(--color-purple)",
	"var(--color-pink)",
];

const GLOBAL_CONFETTI_COUNT = 500;
// Must exceed the longest possible piece's delay + duration below, so the
// overlay isn't removed mid-animation.
const GLOBAL_CONFETTI_LIFETIME = 4800;

/**
 * Fires a short confetti burst across the whole app window (appended to
 * `document.body`, not any specific pane). Used so the celebration is
 * visible even when the sidebar — and its own goal widget — isn't open,
 * the same way Obsidian's `Notice` toasts are.
 */
export function launchGlobalConfetti() {
	const overlay = document.createElement("div");
	overlay.className = "ktr-global-confetti";

	for (let i = 0; i < GLOBAL_CONFETTI_COUNT; i++) {
		const piece = document.createElement("span");
		piece.className = "ktr-global-confetti__piece";

		const color =
			CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
		const left = Math.random() * 100;
		const delay = Math.random() * 0.4;
		const duration = 3.5 + Math.random() * 0.8;
		const drift = Math.random() * 160 - 80;
		const rotation = Math.random() * 720 - 360;

		piece.style.setProperty("--left", `${left}%`);
		piece.style.setProperty("--piece-color", color);
		piece.style.setProperty("--delay", `${delay}s`);
		piece.style.setProperty("--duration", `${duration}s`);
		piece.style.setProperty("--drift", `${drift}px`);
		piece.style.setProperty("--rotation", `${rotation}deg`);

		overlay.appendChild(piece);
	}

	document.body.appendChild(overlay);
	setTimeout(() => overlay.remove(), GLOBAL_CONFETTI_LIFETIME);
}

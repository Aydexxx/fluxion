/** A circular user avatar: shows the uploaded image, or falls back to initials. */

const PALETTE = ["#5b8cff", "#ff7eb6", "#3ecf8e", "#e0a33e", "#b98aff", "#ff8f6b", "#39c6d8", "#d98ae0"];

/** Deterministic color from a string, so a person looks the same everywhere. */
function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Up to two initials from a name, else the first letters of an email/seed. */
function initials(name?: string | null, email?: string | null): string {
  const source = (name && name.trim()) || email || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

interface AvatarProps {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  /** Diameter in px. */
  size?: number;
  /** Override the initials background (e.g. a presence color). */
  color?: string;
  /** Extra classes (e.g. a ring). */
  className?: string;
  title?: string;
}

export function Avatar({ name, email, avatarUrl, size = 32, color, className = "", title }: AvatarProps) {
  const dim = { width: size, height: size };
  const resolvedTitle = title ?? name ?? email ?? undefined;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ? `${name}'s avatar` : "Avatar"}
        title={resolvedTitle}
        style={dim}
        className={`shrink-0 rounded-full object-cover ${className}`}
        draggable={false}
      />
    );
  }

  const bg = color ?? colorFor(name || email || "?");
  return (
    <span
      title={resolvedTitle}
      aria-hidden
      style={{ ...dim, background: bg, fontSize: Math.round(size * 0.4) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${className}`}
    >
      {initials(name, email)}
    </span>
  );
}

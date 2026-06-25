import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePresence } from "./presence";
import type { Participant } from "../lib/presenceEvents";

/** Up to this many avatars render individually; the rest collapse into a "+N". */
const MAX_AVATARS = 4;

/**
 * Stacked avatars of other people viewing the same workflow, shown in the editor
 * top bar. Deduped by user (a person with two tabs appears once), each in their
 * stable presence color — the at-a-glance "who's here" of a collaborative tool.
 */
export function PresenceAvatars() {
  const reduce = useReducedMotion();
  const participants = usePresence((s) => s.participants);

  // One entry per distinct user (collapse a user's multiple tabs/sockets).
  const people = dedupeByUser(Object.values(participants));
  if (people.length === 0) return null;

  const shown = people.slice(0, MAX_AVATARS);
  const overflow = people.length - shown.length;

  return (
    <div className="flex items-center" aria-label={`${people.length} other ${people.length === 1 ? "person" : "people"} here`}>
      <div className="flex items-center -space-x-2">
        <AnimatePresence initial={false}>
          {shown.map((p) => (
            <motion.div
              key={p.userId}
              initial={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 30 }}
              title={p.name}
              className="flex size-7 items-center justify-center rounded-full text-[11px] font-semibold text-white ring-2 ring-surface"
              style={{ background: p.color }}
            >
              {initials(p.name)}
            </motion.div>
          ))}
        </AnimatePresence>
        {overflow > 0 ? (
          <div
            title={`${overflow} more`}
            className="flex size-7 items-center justify-center rounded-full bg-white/10 text-[10.5px] font-semibold text-muted ring-2 ring-surface"
          >
            +{overflow}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function dedupeByUser(participants: Participant[]): Participant[] {
  const seen = new Map<string, Participant>();
  for (const p of participants) if (!seen.has(p.userId)) seen.set(p.userId, p);
  return [...seen.values()];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

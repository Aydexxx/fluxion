import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { navigate } from "../lib/router";
import { EASE, riseIn, stagger, still } from "../lib/motion";
import { Badge } from "../components/ui/Badge";
import {
  BoltIcon,
  BotIcon,
  BranchIcon,
  ChartIcon,
  CheckIcon,
  ChevronRightIcon,
  DatabaseIcon,
  GlobeIcon,
  GridIcon,
  HistoryIcon,
  Logo,
  MailIcon,
  ReplyIcon,
  SparkIcon,
  SpinnerIcon,
  WebhookIcon,
} from "../components/icons";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Public, unauthenticated marketing page — the face a recruiter sees first.
 * Cinematic dark identity with one bold signature element (the looping product
 * preview); everything else stays disciplined. Fully responsive and
 * reduced-motion aware.
 */
export function LandingPage() {
  const previewRef = useRef<HTMLDivElement>(null);
  const scrollToPreview = () => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="relative h-screen overflow-y-auto overflow-x-hidden bg-base">
      <LandingNav />
      <main>
        <Hero onSeeItRun={scrollToPreview} previewRef={previewRef} />
        <FeatureShowcase />
        <CategoryBand />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}

/* ── Nav ──────────────────────────────────────────────────────────────────── */
function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-base/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <button type="button" onClick={() => navigate("/")} className="flex items-center gap-2.5" aria-label="Fluxion home">
          <Logo className="text-[22px] text-accent" />
          <span className="font-display text-[16px] font-semibold tracking-tight">Fluxion</span>
        </button>
        <nav className="hidden items-center gap-7 text-[13.5px] text-muted md:flex">
          <a href="#features" className="transition-colors hover:text-ink">Features</a>
          <a href="#building-blocks" className="transition-colors hover:text-ink">Building blocks</a>
        </nav>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all"
            style={{ background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" }}
          >
            Get started
          </button>
        </div>
      </div>
    </header>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */
function Hero({ onSeeItRun, previewRef }: { onSeeItRun: () => void; previewRef: React.RefObject<HTMLDivElement | null> }) {
  const reduce = useReducedMotion();
  return (
    <section className="relative overflow-hidden px-6 pb-10 pt-16 sm:pt-24">
      {/* Ambient cinematic light */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[680px] bloom opacity-90" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-160px] h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, color-mix(in oklab, var(--color-accent) 30%, transparent), transparent)",
          animation: reduce ? undefined : "flux-float 9s ease-in-out infinite",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 grain opacity-40" />

      <motion.div
        variants={reduce ? still : stagger(0.05, 0.08)}
        initial="hidden"
        animate="show"
        className="relative mx-auto max-w-3xl text-center"
      >
        <motion.div variants={reduce ? still : riseIn} className="mb-6 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface/60 px-3 py-1 text-[12px] text-muted backdrop-blur">
            <span className="size-1.5 rounded-full bg-[var(--color-cat-output)]" style={{ boxShadow: "0 0 8px var(--color-cat-output)" }} />
            Visual AI workflow studio
          </span>
        </motion.div>

        <motion.h1
          variants={reduce ? still : riseIn}
          className="text-balance font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-gradient sm:text-[60px]"
        >
          Compose intelligence on an infinite canvas.
        </motion.h1>

        <motion.p variants={reduce ? still : riseIn} className="mx-auto mt-6 max-w-xl text-[16px] leading-relaxed text-muted sm:text-[17px]">
          Wire triggers to actions to AI models. Branch on logic, loop over data, and ship
          automated, agentic workflows — designed on a canvas, not buried in config.
        </motion.p>

        <motion.div variants={reduce ? still : riseIn} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="flex items-center gap-2 rounded-xl px-5 py-3 text-[14px] font-semibold text-white transition-all hover:brightness-110"
            style={{
              background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
              boxShadow: "0 18px 44px -16px color-mix(in oklab, var(--color-accent) 80%, transparent)",
            }}
          >
            Start building — free
            <ChevronRightIcon className="text-[15px]" />
          </button>
          <button
            type="button"
            onClick={onSeeItRun}
            className="flex items-center gap-2 rounded-xl border border-white/12 px-5 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-white/5"
          >
            <BoltIcon className="text-[15px] text-accent-bright" />
            See it run
          </button>
        </motion.div>
      </motion.div>

      {/* The one bold signature element: a live, looping workflow execution. */}
      <motion.div
        ref={previewRef}
        initial={reduce ? false : { opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: EASE }}
        className="relative mx-auto mt-16 max-w-5xl"
      >
        <div className="absolute -inset-4 -z-10 rounded-[28px] bg-accent/5 blur-2xl" aria-hidden />
        <ProductPreview />
      </motion.div>
    </section>
  );
}

/* ── Product preview (signature looping execution) ──────────────────────────── */
interface PreviewNode {
  id: string;
  label: string;
  sub: string;
  icon: IconType;
  accent: string;
  x: number; // 0..100
  y: number; // 0..62.5 (16:10 space)
}

const PV_NODES: PreviewNode[] = [
  { id: "trigger", label: "Webhook", sub: "trigger", icon: WebhookIcon, accent: "#8b7bff", x: 11, y: 31 },
  { id: "ai", label: "AI Agent", sub: "intelligence", icon: BotIcon, accent: "#c26bff", x: 37, y: 15 },
  { id: "cond", label: "Condition", sub: "logic", icon: BranchIcon, accent: "#e0a33e", x: 37, y: 47 },
  { id: "act", label: "Database", sub: "action", icon: DatabaseIcon, accent: "#4c9bff", x: 64, y: 15 },
  { id: "out", label: "Response", sub: "output", icon: ReplyIcon, accent: "#34d0a8", x: 88, y: 31 },
];
const PV_EDGES: [string, string][] = [
  ["trigger", "ai"],
  ["trigger", "cond"],
  ["ai", "act"],
  ["act", "out"],
  ["cond", "out"],
];
// Execution order the loop sweeps through (topological).
const PV_ORDER = ["trigger", "ai", "cond", "act", "out"];

function ProductPreview() {
  const reduce = useReducedMotion();
  // -1 = idle. Sweeps 0..N, holds, then resets. Reduced motion shows the final state.
  const [step, setStep] = useState(reduce ? PV_ORDER.length : -1);

  useEffect(() => {
    if (reduce) return;
    let i = -1;
    const tick = () => {
      // -1 (idle) → 0..N-1 (each node runs) → N (all green hold) → wrap to -1.
      i = i >= PV_ORDER.length ? -1 : i + 1;
      setStep(i);
    };
    const interval = setInterval(tick, 850);
    return () => clearInterval(interval);
  }, [reduce]);

  const litIndex = (id: string) => PV_ORDER.indexOf(id);
  const isLit = (id: string) => step >= litIndex(id);
  const isRunning = (id: string) => step === litIndex(id);
  const nodeById = (id: string) => PV_NODES.find((n) => n.id === id)!;

  return (
    <figure
      role="img"
      aria-label="A Fluxion workflow executing: a webhook trigger fans out to an AI agent and a condition, then to a database action and a response — each node lighting up in turn."
      className="relative overflow-hidden rounded-[20px] border border-white/10 glass shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
    >
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-white/8 bg-void/40 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="ml-3 font-mono text-[11px] text-faint">support-triage.flux</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[var(--color-cat-output)]/12 px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-cat-output)]">
          <span className="size-1.5 rounded-full bg-[var(--color-cat-output)]" style={{ boxShadow: "0 0 8px var(--color-cat-output)" }} />
          live
        </span>
      </div>

      {/* canvas */}
      <div className="relative aspect-[16/10] w-full bg-[radial-gradient(color-mix(in_oklab,white_5%,transparent)_0.5px,transparent_0.5px)] [background-size:18px_18px]">
        {/* edges */}
        <svg viewBox="0 0 100 62.5" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {PV_EDGES.map(([from, to]) => {
            const a = nodeById(from);
            const b = nodeById(to);
            const lit = isLit(from) && isLit(to);
            const midX = (a.x + b.x) / 2;
            const d = `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
            return (
              <g key={`${from}-${to}`}>
                <path d={d} fill="none" stroke="color-mix(in oklab, white 12%, transparent)" strokeWidth={0.5} />
                {lit ? (
                  <path
                    d={d}
                    fill="none"
                    stroke={b.accent}
                    strokeWidth={0.8}
                    strokeLinecap="round"
                    strokeDasharray="3 5"
                    style={{
                      filter: `drop-shadow(0 0 1px ${b.accent})`,
                      animation: reduce ? undefined : "flux-dash 0.7s linear infinite",
                    }}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {/* nodes */}
        {PV_NODES.map((n) => (
          <PreviewNodeChip key={n.id} node={n} lit={isLit(n.id)} running={isRunning(n.id)} reduce={!!reduce} />
        ))}
      </div>
    </figure>
  );
}

function PreviewNodeChip({ node, lit, running, reduce }: { node: PreviewNode; lit: boolean; running: boolean; reduce: boolean }) {
  const Icon = node.icon;
  const ring = running ? node.accent : lit ? `color-mix(in oklab, ${node.accent} 60%, transparent)` : "color-mix(in oklab, white 10%, transparent)";
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${node.x}%`, top: `${(node.y / 62.5) * 100}%` }}>
      <motion.div
        animate={running && !reduce ? { scale: [1, 1.045, 1] } : { scale: 1 }}
        transition={{ duration: 1, repeat: running ? Infinity : 0, ease: "easeInOut" }}
        className="flex w-[clamp(108px,13vw,148px)] items-center gap-2 rounded-xl border bg-surface/90 px-2.5 py-2 backdrop-blur transition-colors duration-300"
        style={{
          borderColor: ring,
          boxShadow: lit ? `0 0 0 1px ${ring}, 0 10px 30px -14px ${node.accent}` : "0 10px 30px -20px rgba(0,0,0,0.9)",
        }}
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[15px]"
          style={{ color: node.accent, background: `color-mix(in oklab, ${node.accent} 16%, transparent)` }}
        >
          <Icon />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11.5px] font-medium leading-tight text-ink">{node.label}</span>
          <span className="block font-mono text-[8.5px] uppercase tracking-[0.1em]" style={{ color: `color-mix(in oklab, ${node.accent} 80%, white 5%)` }}>
            {node.sub}
          </span>
        </span>
        {/* status pip */}
        <span className="ml-auto">
          {running ? (
            <SpinnerIcon className={`text-[11px] ${reduce ? "" : "animate-spin"}`} style={{ color: node.accent }} />
          ) : lit ? (
            <CheckIcon className="text-[11px] text-[var(--color-cat-output)]" />
          ) : (
            <span className="block size-1.5 rounded-full bg-white/15" />
          )}
        </span>
      </motion.div>
    </div>
  );
}

/* ── Feature showcase ───────────────────────────────────────────────────────── */
const FEATURES: { icon: IconType; accent: string; title: string; body: string }[] = [
  {
    icon: GridIcon,
    accent: "#8b7bff",
    title: "Visual editor",
    body: "An infinite canvas with snapping, multi-select, copy/paste, undo history, and a command palette. Compose flows by dragging, not by writing YAML.",
  },
  {
    icon: BotIcon,
    accent: "#c26bff",
    title: "AI nodes",
    body: "Drop a language model or a multi-step, tool-using agent into any flow. Prompt with live data from upstream nodes and branch on what it returns.",
  },
  {
    icon: BoltIcon,
    accent: "#34d0a8",
    title: "Real-time execution",
    body: "Press run and watch each node light up live over the wire — statuses, timings, inputs and outputs stream to the canvas as the worker executes.",
  },
  {
    icon: GlobeIcon,
    accent: "#4c9bff",
    title: "Integrations",
    body: "HTTP requests, SQL databases, email, Slack & Discord, inbound webhooks, and cron schedules — with an encrypted credential vault behind them.",
  },
];

function FeatureShowcase() {
  const reduce = useReducedMotion();
  return (
    <section id="features" className="relative mx-auto max-w-6xl scroll-mt-20 px-6 py-20 sm:py-28">
      <SectionHeading
        eyebrow="Everything in one studio"
        title="A workflow tool that feels like a design tool"
        subtitle="The polish of a creative app, the power of an automation engine."
      />
      <motion.div
        variants={reduce ? still : stagger(0.05, 0.08)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
        className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        {FEATURES.map((f) => (
          <motion.div
            key={f.title}
            variants={reduce ? still : riseIn}
            className="group relative overflow-hidden rounded-2xl border border-white/8 bg-surface/50 p-6 transition-colors hover:border-white/14"
          >
            <div
              aria-hidden
              className="absolute -right-10 -top-10 size-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: `color-mix(in oklab, ${f.accent} 26%, transparent)` }}
            />
            <div
              className="relative flex size-11 items-center justify-center rounded-xl text-[20px]"
              style={{
                color: f.accent,
                background: `color-mix(in oklab, ${f.accent} 14%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${f.accent} 26%, transparent)`,
              }}
            >
              <f.icon />
            </div>
            <h3 className="relative mt-4 font-display text-[18px] font-semibold text-ink">{f.title}</h3>
            <p className="relative mt-2 text-[14px] leading-relaxed text-muted">{f.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/* ── Building blocks band ───────────────────────────────────────────────────── */
const BLOCKS: { icon: IconType; label: string; accent: string }[] = [
  { icon: WebhookIcon, label: "Triggers", accent: "#8b7bff" },
  { icon: GlobeIcon, label: "HTTP", accent: "#4c9bff" },
  { icon: SparkIcon, label: "AI models", accent: "#c26bff" },
  { icon: BranchIcon, label: "Logic", accent: "#e0a33e" },
  { icon: DatabaseIcon, label: "Databases", accent: "#4c9bff" },
  { icon: MailIcon, label: "Email", accent: "#4c9bff" },
  { icon: HistoryIcon, label: "Run history", accent: "#34d0a8" },
  { icon: ChartIcon, label: "Analytics", accent: "#34d0a8" },
];

function CategoryBand() {
  const reduce = useReducedMotion();
  return (
    <section id="building-blocks" className="relative mx-auto max-w-6xl scroll-mt-20 px-6 py-20 sm:py-24">
      <div className="relative overflow-hidden rounded-3xl border border-white/8 bg-surface/40 px-6 py-12 sm:px-12">
        <div aria-hidden className="pointer-events-none absolute inset-0 bloom opacity-40" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionHeading
              align="left"
              eyebrow="Building blocks"
              title="Snap together the whole pipeline"
              subtitle="A focused node library that covers the real surface area of automation — from the first trigger to the final response."
            />
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Badge color="#8b7bff">Triggers</Badge>
              <Badge color="#4c9bff">Actions</Badge>
              <Badge color="#c26bff">Intelligence</Badge>
              <Badge color="#e0a33e">Logic</Badge>
              <Badge color="#34d0a8">Output</Badge>
            </div>
          </div>
          <motion.div
            variants={reduce ? still : stagger(0.03, 0.05)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {BLOCKS.map((b) => (
              <motion.div
                key={b.label}
                variants={reduce ? still : riseIn}
                className="flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-void/30 px-3 py-4 text-center"
              >
                <span
                  className="flex size-9 items-center justify-center rounded-lg text-[17px]"
                  style={{ color: b.accent, background: `color-mix(in oklab, ${b.accent} 14%, transparent)` }}
                >
                  <b.icon />
                </span>
                <span className="text-[12px] font-medium text-muted">{b.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ── CTA band ──────────────────────────────────────────────────────────────── */
function CtaBand() {
  const reduce = useReducedMotion();
  return (
    <section className="relative px-6 py-20 sm:py-28">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl border border-white/10 px-8 py-16 text-center"
        style={{ background: "linear-gradient(180deg, color-mix(in oklab, var(--color-accent) 10%, var(--color-surface)), var(--color-surface))" }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 bloom opacity-70" />
        <div aria-hidden className="pointer-events-none absolute inset-0 grain opacity-40" />
        <div className="relative">
          <Logo className="mx-auto text-[34px] text-accent" />
          <h2 className="mt-6 font-display text-[30px] font-semibold tracking-tight text-gradient sm:text-[38px]">
            Build your first workflow in minutes.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-muted">
            Free to start. Open a blank canvas or a working template with sample data already wired in.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="rounded-xl px-5 py-3 text-[14px] font-semibold text-white transition-all hover:brightness-110"
              style={{
                background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
                boxShadow: "0 18px 44px -16px color-mix(in oklab, var(--color-accent) 80%, transparent)",
              }}
            >
              Create your studio
            </button>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="rounded-xl border border-white/12 px-5 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-white/5"
            >
              Sign in
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ── Footer ────────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-white/8 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-2.5">
          <Logo className="text-[18px] text-accent" />
          <span className="font-display text-[14px] font-semibold tracking-tight">Fluxion</span>
          <span className="ml-1 text-[12px] text-faint">Compose intelligence on an infinite canvas.</span>
        </div>
        <p className="text-[12px] text-faint">© {new Date().getFullYear()} Fluxion · Built as a portfolio project.</p>
      </div>
    </footer>
  );
}

/* ── shared bits ───────────────────────────────────────────────────────────── */
function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: EASE }}
      className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-md"}
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-bright">{eyebrow}</div>
      <h2 className="mt-3 font-display text-[28px] font-semibold leading-tight tracking-tight text-gradient sm:text-[34px]">
        {title}
      </h2>
      {subtitle ? <p className="mt-3 text-[15px] leading-relaxed text-muted">{subtitle}</p> : null}
    </motion.div>
  );
}

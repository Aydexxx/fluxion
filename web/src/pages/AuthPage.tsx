import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { navigate } from "../lib/router";
import { errorMessage } from "../lib/api";
import { Label, TextInput } from "../components/Field";
import { Logo, SpinnerIcon } from "../components/icons";
import { EASE, riseIn, stagger, still } from "../lib/motion";

type Mode = "login" | "register";

export function AuthPage({ mode }: { mode: Mode }) {
  const reduce = useReducedMotion();
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err, "Authentication failed"));
      setBusy(false);
    }
  };

  return (
    <div className="relative grid h-screen w-screen overflow-hidden bg-base lg:grid-cols-[1.05fr_1fr]">
      <AtmospherePanel reduce={!!reduce} />

      <div className="relative flex items-center justify-center px-6 py-10">
        <motion.div
          variants={reduce ? still : stagger(0.05, 0.07)}
          initial="hidden"
          animate="show"
          className="w-full max-w-[380px]"
        >
          <motion.div variants={reduce ? still : riseIn} className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo className="text-[22px] text-accent" />
            <span className="font-display text-lg font-semibold tracking-tight">Fluxion</span>
          </motion.div>

          <motion.h1 variants={reduce ? still : riseIn} className="text-[26px] font-semibold tracking-tight text-gradient">
            {mode === "register" ? "Create your studio" : "Welcome back"}
          </motion.h1>
          <motion.p variants={reduce ? still : riseIn} className="mt-1.5 text-sm text-muted">
            {mode === "register"
              ? "Spin up a workspace and start orchestrating."
              : "Sign in to your workflows and canvases."}
          </motion.p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            {mode === "register" ? (
              <motion.div variants={reduce ? still : riseIn}>
                <Label htmlFor="name">Name</Label>
                <TextInput
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                />
              </motion.div>
            ) : null}

            <motion.div variants={reduce ? still : riseIn}>
              <Label htmlFor="email">Email</Label>
              <TextInput
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@studio.com"
              />
            </motion.div>

            <motion.div variants={reduce ? still : riseIn}>
              <Label htmlFor="password">Password</Label>
              <TextInput
                id="password"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "••••••••"}
              />
            </motion.div>

            {error ? (
              <motion.p
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-300"
              >
                {error}
              </motion.p>
            ) : null}

            <motion.button
              variants={reduce ? still : riseIn}
              type="submit"
              disabled={busy}
              whileTap={reduce ? undefined : { scale: 0.99 }}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-70"
              style={{
                background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))",
                boxShadow: "0 10px 30px -10px color-mix(in oklab, var(--color-accent) 75%, transparent)",
              }}
            >
              {busy ? <SpinnerIcon className="animate-spin text-[16px]" /> : null}
              {mode === "register" ? "Create account" : "Sign in"}
            </motion.button>
          </form>

          <motion.p variants={reduce ? still : riseIn} className="mt-6 text-center text-[13px] text-muted">
            {mode === "register" ? (
              <>
                Already have an account?{" "}
                <button onClick={() => navigate("/login")} className="font-medium text-accent-bright hover:underline">
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Fluxion?{" "}
                <button onClick={() => navigate("/register")} className="font-medium text-accent-bright hover:underline">
                  Create an account
                </button>
              </>
            )}
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}

/** The cinematic left half — drifting violet bloom, the mark, a line of intent. */
function AtmospherePanel({ reduce }: { reduce: boolean }) {
  return (
    <div className="relative hidden overflow-hidden border-r border-white/5 lg:block">
      <div className="absolute inset-0 bloom" />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-[20%] opacity-70"
        style={{
          background:
            "radial-gradient(40% 35% at 30% 30%, color-mix(in oklab, #7c5cff 30%, transparent), transparent 70%), radial-gradient(35% 30% at 75% 70%, color-mix(in oklab, #4cc2ff 16%, transparent), transparent 70%)",
          animation: reduce ? undefined : "flux-pan 26s linear infinite alternate",
        }}
      />
      <div aria-hidden className="absolute inset-0 grain opacity-50" />

      <div className="relative flex h-full flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <Logo className="text-[26px] text-accent" />
          <span className="font-display text-xl font-semibold tracking-tight">Fluxion</span>
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
          className="max-w-md"
        >
          <h2 className="font-display text-[34px] font-semibold leading-[1.1] tracking-tight text-gradient">
            Compose intelligence on an infinite canvas.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted">
            Wire triggers to actions to models. Branch on logic. Ship automated, agentic workflows — designed, not configured.
          </p>
        </motion.div>

        <div className="flex items-center gap-2 text-[12px] text-faint">
          <span className="size-1.5 rounded-full bg-[var(--color-cat-output)]" />
          Visual workflow studio
        </div>
      </div>
    </div>
  );
}

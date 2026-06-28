import { useEffect } from "react";
import { useAuth } from "./store/auth";
import { getToken } from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { EditorPage } from "./pages/EditorPage";
import { RunsPage } from "./pages/RunsPage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { LandingPage } from "./pages/LandingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AppShell } from "./components/shell/AppShell";
import type { ActiveSection } from "./components/shell/nav";
import type { DefaultLanding } from "./lib/types";
import { ToastProvider } from "./components/ui/toast";
import { ConfirmHost } from "./components/ui/confirm";
import { Logo, SpinnerIcon } from "./components/icons";

// Routes an unauthenticated visitor may stay on. `dashboard` is "/", which
// renders the public landing page when signed out and the app home when signed in.
const ANON_ROUTES = new Set(["login", "register", "dashboard"]);

/** Path the user lands on right after signing in, from their preference. */
const LANDING_PATH: Record<DefaultLanding, string> = {
  workflows: "/",
  templates: "/templates",
  runs: "/runs",
  analytics: "/analytics",
};

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  const user = useAuth((s) => s.user);
  const route = useRoute();

  // Rehydrate the session once on load.
  useEffect(() => {
    if (getToken()) void bootstrap();
    else useAuth.setState({ status: "anon" });
  }, [bootstrap]);

  // Redirect based on auth state once it's known.
  useEffect(() => {
    if (status === "loading") return;
    // Signed-out visitors land on the public marketing page (/) rather than a
    // forced login wall; only deep app links bounce them there.
    if (status === "anon" && !ANON_ROUTES.has(route.name)) navigate("/", { replace: true });
    // On sign-in, send the user to their preferred landing section.
    if (status === "authed" && (route.name === "login" || route.name === "register")) {
      const landing = user?.preferences.defaultLanding;
      navigate(landing ? LANDING_PATH[landing] : "/", { replace: true });
    }
    if (route.name === "notfound") navigate("/", { replace: true });
  }, [status, route, user]);

  return (
    <ToastProvider>
      {status === "loading" ? (
        <Splash />
      ) : (
        <Routed
          routeName={route.name}
          workflowId={route.name === "editor" ? route.workflowId : null}
          runId={route.name === "runDetail" ? route.runId : null}
          authed={status === "authed"}
        />
      )}
      <ConfirmHost />
    </ToastProvider>
  );
}

function Routed({
  routeName,
  workflowId,
  runId,
  authed,
}: {
  routeName: string;
  workflowId: string | null;
  runId: string | null;
  authed: boolean;
}) {
  // While a redirect effect is settling, render a calm splash rather than a flash of the wrong page.
  if (!authed) {
    if (routeName === "register") return <AuthPage mode="register" />;
    if (routeName === "login") return <AuthPage mode="login" />;
    if (routeName === "dashboard") return <LandingPage />; // "/" when signed out
    return <Splash />;
  }

  // The editor is full-bleed and brings its own chrome — it stays outside the shell.
  if (routeName === "editor" && workflowId) return <EditorPage workflowId={workflowId} />;
  // The profile page is a personal, standalone surface (its own back-to-app header).
  if (routeName === "profile") return <ProfilePage />;

  const shellPage = renderShellPage(routeName, runId);
  if (shellPage) return <AppShell active={shellPage.active}>{shellPage.content}</AppShell>;

  return <Splash />;
}

/** Map a route to its in-shell page and the section the rail should highlight. */
function renderShellPage(
  routeName: string,
  runId: string | null,
): { active: ActiveSection; content: React.ReactNode } | null {
  if (routeName === "dashboard") return { active: "workflows", content: <DashboardPage /> };
  if (routeName === "templates") return { active: "templates", content: <TemplatesPage /> };
  if (routeName === "runs") return { active: "runs", content: <RunsPage /> };
  if (routeName === "runDetail" && runId) return { active: "runs", content: <RunDetailPage runId={runId} /> };
  if (routeName === "analytics") return { active: "analytics", content: <AnalyticsPage /> };
  return null;
}

function Splash() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-base">
      <div className="bloom pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative flex flex-col items-center gap-4">
        <Logo className="text-[30px] text-accent" />
        <SpinnerIcon className="animate-spin text-[18px] text-muted" />
      </div>
    </div>
  );
}

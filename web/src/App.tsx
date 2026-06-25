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
import { ToastProvider } from "./components/ui/toast";
import { ConfirmHost } from "./components/ui/confirm";
import { Logo, SpinnerIcon } from "./components/icons";

// Routes an unauthenticated visitor may stay on. `dashboard` is "/", which
// renders the public landing page when signed out and the app home when signed in.
const ANON_ROUTES = new Set(["login", "register", "dashboard"]);

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
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
    if (status === "authed" && (route.name === "login" || route.name === "register")) navigate("/", { replace: true });
    if (route.name === "notfound") navigate("/", { replace: true });
  }, [status, route]);

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

  if (routeName === "editor" && workflowId) return <EditorPage workflowId={workflowId} />;
  if (routeName === "dashboard") return <DashboardPage />;
  if (routeName === "templates") return <TemplatesPage />;
  if (routeName === "runs") return <RunsPage />;
  if (routeName === "runDetail" && runId) return <RunDetailPage runId={runId} />;
  if (routeName === "analytics") return <AnalyticsPage />;
  return <Splash />;
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

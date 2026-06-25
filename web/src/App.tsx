import { useEffect } from "react";
import { useAuth } from "./store/auth";
import { getToken } from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { EditorPage } from "./pages/EditorPage";
import { RunsPage } from "./pages/RunsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { ToastProvider } from "./components/ui/toast";
import { ConfirmHost } from "./components/ui/confirm";
import { Logo, SpinnerIcon } from "./components/icons";

const PUBLIC_ROUTES = new Set(["login", "register"]);

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
    const isPublic = PUBLIC_ROUTES.has(route.name);
    if (status === "anon" && !isPublic) navigate("/login", { replace: true });
    if (status === "authed" && isPublic) navigate("/", { replace: true });
    if (route.name === "notfound") navigate(status === "authed" ? "/" : "/login", { replace: true });
  }, [status, route]);

  return (
    <ToastProvider>
      {status === "loading" ? (
        <Splash />
      ) : (
        <Routed
          routeName={route.name}
          workflowId={route.name === "editor" ? route.workflowId : null}
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
  authed,
}: {
  routeName: string;
  workflowId: string | null;
  authed: boolean;
}) {
  // While a redirect effect is settling, render a calm splash rather than a flash of the wrong page.
  if (!authed) {
    if (routeName === "register") return <AuthPage mode="register" />;
    if (routeName === "login") return <AuthPage mode="login" />;
    return <Splash />;
  }

  if (routeName === "editor" && workflowId) return <EditorPage workflowId={workflowId} />;
  if (routeName === "dashboard") return <DashboardPage />;
  if (routeName === "runs") return <RunsPage />;
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

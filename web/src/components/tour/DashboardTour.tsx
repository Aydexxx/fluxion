import { OnboardingTour, type TourStep } from "./OnboardingTour";

const STORAGE_KEY = "fluxion.tour.dashboard.v1";

/** A two-beat welcome shown the first time the dashboard loads. */
const STEPS: TourStep[] = [
  {
    title: "Welcome to Fluxion",
    body: "This is your workspace home — every workflow lives here. A couple of quick pointers to get you moving.",
  },
  {
    target: '[data-tour="templates"]',
    title: "Start from a template",
    body: "New here? Templates are working examples wired with sample data — the fastest way to see a real flow run.",
  },
];

/** Mounted on the dashboard; fires once for first-time users. */
export function DashboardTour({ enabled = true }: { enabled?: boolean }) {
  return <OnboardingTour steps={STEPS} storageKey={STORAGE_KEY} enabled={enabled} startDelay={800} />;
}

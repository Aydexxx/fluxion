import { useEditor } from "../../editor/editorStore";
import { OnboardingTour, type TourStep } from "./OnboardingTour";

const STORAGE_KEY = "fluxion.tour.editor.v1";

/** The first-time editor walkthrough: the four things a newcomer needs. */
const STEPS: TourStep[] = [
  {
    target: '[data-tour="node-palette"]',
    title: "Start with the node library",
    body: "Drag a trigger, action, or AI model onto the canvas — or click one to drop it in the center.",
  },
  {
    target: '[data-tour="run-button"]',
    title: "Run it anytime",
    body: "Press Run to execute the workflow. Nodes light up live as each step finishes, with results on the canvas.",
  },
  {
    title: "Wire data between steps",
    body: "Select a node and open its settings, then use the ⚡ data picker to insert live values from upstream steps.",
  },
  {
    target: '[data-tour="publish-button"]',
    title: "Publish when it's ready",
    body: "Promote your saved draft to the live version. Active webhook and schedule triggers always run what you publish.",
  },
];

/** Runs once the canvas is ready (mounted only on desktop by the editor page). */
export function EditorTour() {
  const ready = useEditor((s) => s.status === "ready");
  return <OnboardingTour steps={STEPS} storageKey={STORAGE_KEY} enabled={ready} startDelay={900} />;
}

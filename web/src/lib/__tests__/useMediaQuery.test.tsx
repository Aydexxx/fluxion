import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useIsMobile, useIsTouchMobile } from "../useMediaQuery";

/**
 * Install a matchMedia that evaluates a query against a fake device: it honours
 * `(pointer: coarse)` and `(max-width: Npx)` so we can model "narrow desktop"
 * (fine pointer, small width) vs. a real phone (coarse pointer, small width).
 */
function installMatchMedia(device: { pointer: "fine" | "coarse"; width: number }) {
  window.matchMedia = ((query: string) => {
    const needsCoarse = query.includes("pointer: coarse");
    const maxWidth = query.match(/max-width:\s*(\d+)px/);
    const widthOk = maxWidth ? device.width <= Number(maxWidth[1]) : true;
    const pointerOk = needsCoarse ? device.pointer === "coarse" : true;
    return {
      matches: widthOk && pointerOk,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

function Probe() {
  return (
    <>
      <span data-testid="mobile">{String(useIsMobile())}</span>
      <span data-testid="touch">{String(useIsTouchMobile())}</span>
    </>
  );
}

const mobile = () => screen.getByTestId("mobile").textContent;
const touch = () => screen.getByTestId("touch").textContent;

afterEach(() => {
  // @ts-expect-error reset between cases
  delete window.matchMedia;
});

describe("device detection", () => {
  it("treats a narrow/split-screen DESKTOP window as NOT a phone (editor stays usable)", () => {
    installMatchMedia({ pointer: "fine", width: 560 }); // half a desktop screen, mouse
    render(<Probe />);
    // Layout-wise it's compact (useIsMobile)…
    expect(mobile()).toBe("true");
    // …but it is NOT a touch phone, so the editor must not gate.
    expect(touch()).toBe("false");
  });

  it("treats a real phone (coarse pointer + small viewport) as a phone", () => {
    installMatchMedia({ pointer: "coarse", width: 390 });
    render(<Probe />);
    expect(mobile()).toBe("true");
    expect(touch()).toBe("true");
  });

  it("never flags a full-size desktop", () => {
    installMatchMedia({ pointer: "fine", width: 1440 });
    render(<Probe />);
    expect(mobile()).toBe("false");
    expect(touch()).toBe("false");
  });

  it("does not flag a touch device on a large viewport (e.g. a tablet/desktop touchscreen)", () => {
    installMatchMedia({ pointer: "coarse", width: 1024 }); // coarse but wide → above the 600px gate
    render(<Probe />);
    expect(touch()).toBe("false");
  });
});

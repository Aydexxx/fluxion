import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { errorMessage } from "../api";

describe("errorMessage", () => {
  it("prefers the backend's { error: { message } } payload", () => {
    const error = new AxiosError("Request failed");
    error.response = { data: { error: { message: "Email is already registered" } } } as never;
    expect(errorMessage(error)).toBe("Email is already registered");
  });

  it("falls back to the AxiosError's own message when there's no payload", () => {
    const error = new AxiosError("Network Error");
    expect(errorMessage(error)).toBe("Network Error");
  });

  it("uses a plain Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("uses the fallback for a non-Error value", () => {
    expect(errorMessage("just a string")).toBe("Something went wrong");
    expect(errorMessage(null, "custom fallback")).toBe("custom fallback");
  });
});

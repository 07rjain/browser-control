import { describe, expect, it } from "vitest";
import { greetingFor, selectedModelLabel, setupSteps, STARTER_TASKS } from "../src/sidepanel/welcome";

const states = (authState: Parameters<typeof setupSteps>[0], missing = false) =>
  setupSteps(authState, missing).map((step) => step.state);

describe("welcome setup steps", () => {
  it("follows the connection and sign-in state", () => {
    expect(states("checking")).toEqual(["current", "upcoming", "upcoming"]);
    expect(states("offline")).toEqual(["attention", "upcoming", "upcoming"]);
    expect(states("signed-out")).toEqual(["done", "current", "upcoming"]);
    expect(states("authenticating")).toEqual(["done", "current", "upcoming"]);
    expect(states("error")).toEqual(["done", "attention", "upcoming"]);
  });

  it("tells a missing companion apart from one that stopped responding", () => {
    expect(setupSteps("offline", true)[0].detail).toMatch(/not installed/i);
    expect(setupSteps("offline", false)[0].detail).toMatch(/not responding/i);
    expect(setupSteps("authenticating", false)[1].detail).toMatch(/browser tab/i);
  });
});

describe("welcome home", () => {
  it("greets by time of day", () => {
    expect(greetingFor(8)).toBe("Good morning");
    expect(greetingFor(15)).toBe("Good afternoon");
    expect(greetingFor(22)).toBe("Good evening");
    expect(greetingFor(2)).toBe("Good evening");
  });

  it("offers distinct starter tasks", () => {
    expect(new Set(STARTER_TASKS.map((task) => task.prompt)).size).toBe(STARTER_TASKS.length);
  });

  it("names the model shown beside attach", () => {
    const models = [
      { id: "gpt-5.5", name: "GPT-5.5", isDefault: true },
      { id: "gpt-5.4", name: "GPT-5.4", isDefault: false },
    ];
    expect(selectedModelLabel(models, "")).toBe("GPT-5.5");
    expect(selectedModelLabel(models, "gpt-5.4")).toBe("GPT-5.4");
    expect(selectedModelLabel([], "")).toBe("Codex default");
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import AssistantMarkdown from "../src/sidepanel/AssistantMarkdown";

afterEach(cleanup);

it.each([
  ["inline dollars", String.raw`The ratio is $\frac{1}{2}$.`, false],
  ["inline parentheses", String.raw`The ratio is \(\frac{1}{2}\).`, false],
  ["display dollars", String.raw`The ratio is:

$$
\frac{1}{2}
$$`, true],
  ["display brackets", String.raw`The ratio is:
\[
\frac{1}{2}
\]`, true],
] as const)("typesets %s as accessible math instead of raw LaTeX", (_name, text, display) => {
  const { container } = render(<AssistantMarkdown text={text} />);
  const math = container.querySelector("math");
  expect(math).not.toBeNull();
  expect(math?.querySelector("mfrac")).not.toBeNull();
  expect(math?.getAttribute("display") === "block").toBe(display);
  expect(container.querySelector("h1")).toBeNull();
});

it("preserves code, literal escapes and prices while rendering surrounding equations", () => {
  const text = String.raw`Inline example: \`\(x^2\)\`.

\`\`\`latex
\[x^2\]
\`\`\`

    \(x^2\)

Prices are $5 today and $10 tomorrow. An escaped example is \\(x^2\\).

Actual equation: \(x^2\).`.replaceAll("\\`", "`");
  const { container } = render(<AssistantMarkdown text={text} />);
  expect([...container.querySelectorAll("code")].map((node) => node.textContent?.trim())).toEqual([String.raw`\(x^2\)`, String.raw`\[x^2\]`, String.raw`\(x^2\)`]);
  expect(container.querySelectorAll("math")).toHaveLength(1);
  expect(container.textContent).toContain("Prices are $5 today and $10 tomorrow.");
});

it("finishes an equation arriving in streamed chunks and keeps malformed math readable", () => {
  const { container, rerender } = render(<AssistantMarkdown text={String.raw`Equation: \[\frac{1}{`} />);
  expect(container.textContent).toContain(String.raw`\frac{1}{`);
  rerender(<AssistantMarkdown text={String.raw`Equation: \[\frac{1}{2}\]`} />);
  expect(container.querySelector("math mfrac")).not.toBeNull();
  rerender(<AssistantMarkdown text={String.raw`Bad: \(\notARealCommand{broken}\). Still readable.`} />);
  expect(container.textContent).toContain("Still readable.");
  expect(container.textContent).toContain("notARealCommand");
});

it("keeps untrusted math and Markdown from creating images, scripts or unsafe links", () => {
  render(<AssistantMarkdown text={String.raw`\(\href{javascript:alert(1)}{click}\)

\(\includegraphics{https://example.com/track.png}\)

![remote](https://example.com/image.png) [unsafe](javascript:alert(1)) [safe](https://example.com/docs)

<img src="https://example.com/raw.png" onerror="alert(1)">`} />);
  expect(document.querySelectorAll("img, script, iframe")).toHaveLength(0);
  const links = screen.getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute("href")).toBe("https://example.com/docs");
});

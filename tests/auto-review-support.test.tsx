// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AutoReviewSupport from "../src/sidepanel/AutoReviewSupport";
import { COMPANION_RELEASE_URL } from "../src/shared/companion-support";

afterEach(cleanup);

it.each([["mac", "macOS", "Terminal"], ["win", "Windows", "PowerShell"], ["linux", "Linux", "Terminal"]])(
  "shows the repair for %s without changing permission or executing an installer", (desktopOs, platform, terminal) => {
    const onOpen = vi.fn(async () => undefined), onCheck = vi.fn(async () => undefined);
    render(<AutoReviewSupport support={{ state: "companion-update", message: "The companion needs an update.", codexVersion: "0.169.0" }}
      desktopOs={desktopOs} disabled={false} onCheck={onCheck} onOpen={onOpen} />);
    expect(screen.getByText(`Update steps for ${platform}`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Open ${terminal} in the extracted folder`))).toBeTruthy();
    expect(screen.getByText(/same companion package supports Linux, macOS, and Windows/)).toBeTruthy();
    expect(screen.getByText(/version not reported by this companion/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download companion update" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(COMPANION_RELEASE_URL);
    expect(onCheck).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check support again" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  },
);

it("keeps a support recheck disabled during active work", () => {
  render(<AutoReviewSupport support={{ state: "unavailable", message: "Connection failed." }} desktopOs="mac" disabled
    onCheck={async () => undefined} onOpen={async () => undefined} />);
  expect((screen.getByRole("button", { name: "Check support again" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Download companion update" })).toBeNull();
});

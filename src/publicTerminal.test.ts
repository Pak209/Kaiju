import { describe, expect, it } from "vitest";
import { createPublicTerminalModel, isPublicTerminalAsset } from "./publicTerminal";

describe("Public Terminal procedural asset", () => {
  it("recognizes the catalog asset and exposes separable action-ready parts", () => {
    expect(isPublicTerminalAsset("Public Terminal")).toBe(true);
    expect(isPublicTerminalAsset("Other prop", "Assets/HoloCity/PublicTerminal.prefab")).toBe(true);
    const terminal = createPublicTerminalModel();
    const runtime = terminal.userData.sculptRuntime as { nodes: Record<string, unknown>; sockets: Record<string, unknown> };
    expect(Object.keys(runtime.nodes)).toEqual(expect.arrayContaining([
      "exposed-dark-chassis",
      "deep-canted-screen-hood",
      "large-cyan-inset-display",
      "right-service-pod",
      "left-split-slab-foot",
      "right-split-slab-foot",
    ]));
    expect(runtime.sockets.interaction).toBeTruthy();
    expect(terminal.getObjectByName("large-cyan-inset-display-mesh")).toBeTruthy();
    expect(terminal.children.some((child) => child.name.startsWith("screen-interface-line-"))).toBe(false);
    expect(terminal.getObjectByName("intake-vent-1")).toBeTruthy();
  });
});

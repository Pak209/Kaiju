import { describe, expect, it } from "vitest";
import { createHabitatStackModel, isHabitatStackAsset } from "./habitatStack";

describe("Habitat Stack procedural asset", () => {
  it("keeps separate staggered habitats, services, terraces, and entry runtime anchors", () => {
    expect(isHabitatStackAsset("Habitat Stack")).toBe(true);
    expect(isHabitatStackAsset("Other", "Assets/HoloCity/HabitatStack.prefab")).toBe(true);
    const stack = createHabitatStackModel();
    const runtime = stack.userData.sculptRuntime as { nodes: Record<string, unknown>; sockets: Record<string, unknown> };
    expect(Object.keys(runtime.nodes)).toEqual(expect.arrayContaining(["ground-level-podium", "floor-01", "floor-03", "floor-05", "east-narrow-circulation-core", "broad-roof-transfer-frame", "roof-garden-terrace", "vegetation-upper-left-roof-crown", "vegetation-upper-right-terrace", "vegetation-level-four-west-ledge", "vegetation-level-three-east-ledge", "vegetation-left-mid-shrubs", "vegetation-lower-terrace-shrubs"]));
    expect(runtime.sockets.entry).toBeTruthy();
    expect(stack.getObjectByName("floor-03-room--1.45-window-0-0")).toBeTruthy();
    expect(stack.getObjectByName("floor-04-transfer-a")).toBeTruthy();
    expect(stack.getObjectByName("podium-lobby-storefront")).toBeTruthy();
    expect(stack.getObjectByName("floor-03-rear-access-catwalk")).toBeTruthy();
    expect(stack.getObjectByName("podium-rear-loading-door")).toBeTruthy();
    expect(stack.getObjectByName("vegetation-upper-left-roof-crown-attached-planter")).toBeTruthy();
    expect(stack.getObjectByName("vegetation-upper-left-roof-crown-canopy-0.08--0.08-0")).toBeTruthy();
    expect(stack.getObjectByName("vegetation-level-four-west-ledge-trailing-vine-0-0")).toBeTruthy();
    expect(stack.getObjectByName("roof-antenna-0.64")).toBeTruthy();
  });
});

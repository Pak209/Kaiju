import { describe, expect, it } from "vitest";
import { classifySceneEntry } from "./sceneGroups";
import type { SceneEntry, Transform } from "./types";

const transform: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};
const entry = (
  name: string,
  prefabPath: string,
  editable = true,
): SceneEntry => ({
  id: name,
  name,
  prefabPath,
  editable,
  transform,
});

describe("scene display groups", () => {
  it("groups common vegetation and building paths", () => {
    expect(
      classifySceneEntry(
        entry("Tree_Umbrella_8", "Assets/HoloCity/Nature/Trees/Tree.prefab"),
      ),
    ).toBe("Vegetation");
    expect(
      classifySceneEntry(
        entry("SM_Building05", "Assets/City/Prefabs/SM_Building05.prefab"),
      ),
    ).toBe("Buildings");
  });

  it("keeps meshless locked aggregates in context", () => {
    expect(classifySceneEntry(entry("DistrictDressing", "", false))).toBe(
      "Context",
    );
  });
});

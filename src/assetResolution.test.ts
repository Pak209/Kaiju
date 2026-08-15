import { describe, expect, it } from "vitest";
import { createAssetIndex, resolveSceneGlb } from "./assetResolution";
import type { SceneEntry, Transform } from "./types";

const transform: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};
const entry = (overrides: Partial<SceneEntry>): SceneEntry => ({
  id: "id",
  name: "Tree_Umbrella_8",
  editable: true,
  transform,
  ...overrides,
});

describe("legacy bundle GLB resolution", () => {
  const files = new Map<string, File>([
    ["glb/TreeUmbrella_CityLOD.glb", {} as File],
    ["glb/SM_Building05.glb", {} as File],
  ]);
  const index = createAssetIndex(files);

  it("uses the prefab or FBX basename when scene glb is absent", () => {
    expect(
      resolveSceneGlb(
        entry({ prefabPath: "Assets/Nature/TreeUmbrella_CityLOD.prefab" }),
        index,
      ),
    ).toBe("glb/TreeUmbrella_CityLOD.glb");
  });

  it("uses an exact scene object name when available", () => {
    expect(resolveSceneGlb(entry({ name: "SM_Building05" }), index)).toBe(
      "glb/SM_Building05.glb",
    );
  });
});

import { describe, expect, it } from "vitest";
import { applySkyboxMacroLayout } from "./skyboxLayout";
import type { EditableItem, SceneEntry, Transform } from "./types";

const transform = (position: [number, number, number]): Transform => ({
  position,
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

const editable = (
  id: string,
  name: string,
  position: [number, number, number],
): EditableItem => ({
  id,
  name,
  prefabPath: `Assets/${name}.prefab`,
  transform: transform(position),
  priorTransform: transform(position),
  isAdded: false,
  deleted: false,
});

const entry = (
  id: string,
  name: string,
  position: [number, number, number],
  kitFamily?: string,
): SceneEntry => ({
  id,
  name,
  kitFamily,
  prefabPath: `Assets/${name}.prefab`,
  editable: true,
  transform: transform(position),
});

describe("skybox macro layout", () => {
  it("moves known landmarks without touching unrelated dressing", () => {
    const items = [
      editable("tower", "Density_G_AzurespireTower", [-40, 1, 68]),
      editable("plant", "Plant_01", [8, 0, 9]),
    ];
    const entries = [
      entry("tower", "Density_G_AzurespireTower", [-40, 1, 68]),
      entry("plant", "Plant_01", [8, 0, 9], "Plants"),
    ];
    const result = applySkyboxMacroLayout(items, entries);
    expect(result.changed).toBe(1);
    expect(result.editable[0].transform.position).toEqual([0, 1, 20]);
    expect(result.editable[0].transform.scale).toEqual([1.15, 1.15, 1.15]);
    expect(result.editable[1]).toBe(items[1]);
  });

  it("translates a family cluster while preserving relative spacing", () => {
    const items = [
      editable("a", "Marketplace_StallA", [98, 5, -58]),
      editable("b", "Marketplace_StallB", [102, 5, -54]),
    ];
    const entries = [
      entry("a", "Marketplace_StallA", [98, 5, -58], "Marketplace"),
      entry("b", "Marketplace_StallB", [102, 5, -54], "Marketplace"),
    ];
    const result = applySkyboxMacroLayout(items, entries);
    expect(result.editable.map((item) => item.transform.position)).toEqual([
      [66, 5, -58],
      [70, 5, -54],
    ]);
  });

  it("is idempotent when the macro pass is applied twice", () => {
    const items = [
      editable("tower", "Density_G_AzurespireTower", [-40, 1, 68]),
    ];
    const entries = [
      entry("tower", "Density_G_AzurespireTower", [-40, 1, 68]),
    ];
    const first = applySkyboxMacroLayout(items, entries);
    const second = applySkyboxMacroLayout(first.editable, entries);
    expect(second.changed).toBe(0);
    expect(second.editable[0].transform.scale).toEqual([1.15, 1.15, 1.15]);
  });
});

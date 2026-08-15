import { cloneTransform, sameTransform } from "./core";
import type { EditableItem, SceneEntry } from "./types";

type Xz = readonly [number, number];

const landmarkTargets: Record<string, Xz> = {
  Density_G_AzurespireTower: [0, 20],
  Billboard_HoloTower: [-8, 18],
  Density_C_CivicSpire: [-42, 38],
  Density_H_CivicSpire: [44, 42],
  Density_B_HabitatStack: [-28, 54],
  Density_E_HabitatStack: [31, 50],
  Density_D_BridgePair: [5, 62],
  Density_A_TerraceBlock: [-54, 14],
  Density_F_TerraceBlock: [54, 18],
  Sky_CivicSpire_2: [-82, 112],
  Sky_CivicSpire_7: [84, 116],
  Sky_CivicSpire_12: [-6, 138],
  Sky_HabitatStack_0: [-55, 88],
  Sky_HabitatStack_5: [56, 90],
  Sky_HabitatStack_10: [-38, 118],
  Sky_HabitatStack_15: [-108, 112],
  Sky_TerraceBlock_1: [-72, 94],
  Sky_TerraceBlock_6: [72, 98],
  Sky_TerraceBlock_11: [38, 122],
  Sky_TerraceBlock_16: [108, 116],
  Sky_BridgePair_3: [-68, 110],
  Sky_BridgePair_8: [68, 112],
  Sky_BridgePair_13: [-16, 132],
  GuildHall: [-70, -48],
};

const clusteredFamilies: Record<string, Xz> = {
  Marketplace: [68, -56],
  PortalRing: [0, 106],
};

export type SkyboxLayoutResult = {
  editable: EditableItem[];
  changed: number;
  landmarkCount: number;
};

/**
 * First-pass composition for the HoloCity skybox reference.
 *
 * Only known editable landmark families are moved. Fine dressing, vegetation,
 * docks, roads, terrain and locked context stay untouched. Family clusters are
 * translated as a unit so their internal spacing is preserved.
 */
export function applySkyboxMacroLayout(
  editable: EditableItem[],
  entries: SceneEntry[],
): SkyboxLayoutResult {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const activeByFamily = new Map<string, EditableItem[]>();

  for (const item of editable) {
    if (item.deleted) continue;
    const family = entriesById.get(item.id)?.kitFamily;
    if (!family || !(family in clusteredFamilies)) continue;
    const familyItems = activeByFamily.get(family) ?? [];
    familyItems.push(item);
    activeByFamily.set(family, familyItems);
  }

  const familyOffsets = new Map<string, Xz>();
  for (const [family, items] of activeByFamily) {
    const center = items.reduce<[number, number]>(
      (sum, item) => [
        sum[0] + item.transform.position[0],
        sum[1] + item.transform.position[2],
      ] as [number, number],
      [0, 0] as [number, number],
    );
    center[0] /= items.length;
    center[1] /= items.length;
    const target = clusteredFamilies[family];
    familyOffsets.set(family, [target[0] - center[0], target[1] - center[1]]);
  }

  let changed = 0;
  const result = editable.map((item) => {
    if (item.deleted) return item;
    const entry = entriesById.get(item.id);
    if (!entry) return item;
    const exactTarget = landmarkTargets[entry.name];
    const familyOffset = entry.kitFamily
      ? familyOffsets.get(entry.kitFamily)
      : undefined;
    if (!exactTarget && !familyOffset) return item;

    const next = { ...item, transform: cloneTransform(item.transform) };
    if (exactTarget) {
      next.transform.position[0] = exactTarget[0];
      next.transform.position[2] = exactTarget[1];
      if (entry.name === "Density_G_AzurespireTower") {
        const baseScale = item.priorTransform?.scale ?? item.transform.scale;
        next.transform.scale = baseScale.map(
          (value) => value * 1.15,
        ) as EditableItem["transform"]["scale"];
      }
    } else if (familyOffset) {
      next.transform.position[0] += familyOffset[0];
      next.transform.position[2] += familyOffset[1];
    }
    if (sameTransform(next.transform, item.transform)) return item;
    changed += 1;
    return next;
  });

  return {
    editable: result,
    changed,
    landmarkCount: Object.keys(landmarkTargets).length,
  };
}

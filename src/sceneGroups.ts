import type { SceneEntry } from "./types";

export const sceneGroups = [
  "Vegetation",
  "Buildings",
  "Props",
  "Terrain",
  "Characters",
  "Context",
  "Other",
] as const;

export type SceneGroup = (typeof sceneGroups)[number];

export function classifySceneEntry(entry: SceneEntry): SceneGroup {
  const text = [entry.name, entry.kitFamily, entry.prefabPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/plant|tree|grass|bush|flower|vegetation|nature/.test(text)) {
    return "Vegetation";
  }
  if (
    /building|buliding|guildhall|habitat|terrace|workshop|civic|spire|arena|marketplace/.test(
      text,
    )
  ) {
    return "Buildings";
  }
  if (/actor|avatar|citizen|population|resident|bot|drone|mech/.test(text)) {
    return "Characters";
  }
  if (
    /rock|boulder|terrain|mountain|mt3d|horizon|backdrop|water|ocean|sea_|sky_/.test(
      text,
    )
  ) {
    return "Terrain";
  }
  if (!entry.editable && !entry.glb) return "Context";
  if (/dock|street|park|portdetail|livingcity|prop|mission|bridge/.test(text)) {
    return "Props";
  }
  return entry.editable ? "Props" : "Other";
}

export function groupForEntry(
  entry: SceneEntry,
  overrides?: Partial<Record<string, SceneGroup>>,
) {
  return overrides?.[entry.id] ?? classifySceneEntry(entry);
}

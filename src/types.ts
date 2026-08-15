export type Transform = {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
};
export type SceneEntry = {
  id: string;
  name: string;
  prefabPath?: string;
  kitFamily?: string;
  editable: boolean;
  transform: Transform;
  glb?: string;
  boundsSize?: [number, number, number];
};
export type SceneExport = {
  schemaVersion: "1.0.0";
  kind: "holocity.scene-export";
  sceneName: string;
  unityScenePath: string;
  exportedAt: string;
  exportMode: "district" | "whole";
  districtName?: string;
  baseHash: string;
  entries: SceneEntry[];
};
export type PaletteItem = {
  prefabPath: string;
  displayName: string;
  kitFamily: string;
  glb: string;
  thumbnail?: string;
  defaultScale?: [number, number, number];
  defaultRotation?: [number, number, number, number];
};
export type Palette = {
  schemaVersion: "1.0.0";
  kind: "holocity.palette";
  items: PaletteItem[];
};
export type Diff = {
  schemaVersion: "1.0.0";
  kind: "holocity.placement-diff";
  sceneName: string;
  baseHash: string;
  createdAt: string;
  modified: { id: string; transform: Transform; priorTransform: Transform }[];
  added: { tempId: string; prefabPath: string; transform: Transform }[];
  deleted: { id: string; priorTransform: Transform }[];
};
export type EditableItem = {
  id: string;
  name: string;
  prefabPath: string;
  transform: Transform;
  priorTransform?: Transform;
  isAdded: boolean;
  deleted: boolean;
};
export type Session = {
  scene: SceneExport;
  palette: Palette;
  editable: EditableItem[];
  diffCreatedAt: string;
  viewGroups?: Record<string, import("./sceneGroups").SceneGroup>;
};

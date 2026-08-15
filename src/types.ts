export type Transform = {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
};

/**
 * Static flag names, never indices. Unity's StaticEditorFlags is a bitmask
 * whose numeric values are an implementation detail; the names survive.
 */
export type StaticFlagName =
  | "ContributeGI"
  | "OccluderStatic"
  | "OccludeeStatic"
  | "BatchingStatic"
  | "NavigationStatic"
  | "OffMeshLinkGeneration"
  | "ReflectionProbeStatic";

/**
 * Non-transform state that can cross the boundary.
 *
 * Every key is optional, and ABSENCE MEANS "LEAVE IT ALONE" — which is not the
 * same as the key being present holding a default value. A diff sending
 * `active: true` asserts a change to true; a diff omitting `active` asserts
 * nothing about it. The importer leans on that distinction so a session never
 * stomps a field it did not touch.
 */
export type EntityState = {
  /** null = scene root. */
  parentId?: string | null;
  active?: boolean;
  /** Layer NAME, never an index. */
  layer?: string;
  tag?: string;
  /** The full set, not a delta. */
  staticFlags?: StaticFlagName[];
  /** Key from the prefab's palette materialVariants, or null for the prefab default. */
  materialVariant?: string | null;
};

export type SceneEntry = {
  id: string;
  name: string;
  /** id of the nearest ancestor that is also an entry; absent = scene root. */
  parentId?: string;
  prefabPath?: string;
  kitFamily?: string;
  editable: boolean;
  transform: Transform;
  state?: EntityState;
  glb?: string;
  boundsSize?: [number, number, number];
};
export type SceneExport = {
  schemaVersion: "1.1.0";
  kind: "holocity.scene-export";
  sceneName: string;
  unityScenePath: string;
  exportedAt: string;
  exportMode: "district" | "whole";
  districtName?: string;
  baseHash: string;
  entries: SceneEntry[];
};

export type MaterialVariant = {
  key: string;
  displayName: string;
  swatch?: string;
};
export type PaletteItem = {
  prefabPath: string;
  displayName: string;
  kitFamily: string;
  glb: string;
  thumbnail?: string;
  defaultScale?: [number, number, number];
  /**
   * The prefab root's own axis fix. SEED an added item with this, then store
   * the absolute rotation. It is not a delta to be composed on the Unity side
   * — the importer assigns whatever the diff carries.
   */
  defaultRotation?: [number, number, number, number];
  /** Closed set. A variant key absent from here can never be applied. */
  materialVariants?: MaterialVariant[];
};
export type Palette = {
  schemaVersion: "1.1.0";
  kind: "holocity.palette";
  items: PaletteItem[];
};

export type Diff = {
  schemaVersion: "1.1.0";
  kind: "holocity.placement-diff";
  sceneName: string;
  baseHash: string;
  createdAt: string;
  modified: {
    id: string;
    transform: Transform;
    priorTransform: Transform;
    state?: EntityState;
    priorState?: EntityState;
  }[];
  added: { tempId: string; prefabPath: string; transform: Transform; state?: EntityState }[];
  deleted: { id: string; priorTransform: Transform }[];
};

export type EditableItem = {
  id: string;
  name: string;
  prefabPath: string;
  transform: Transform;
  priorTransform?: Transform;
  /** Live state as edited in this session. */
  state?: EntityState;
  /** State at export — the baseline every state change is diffed against. */
  priorState?: EntityState;
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

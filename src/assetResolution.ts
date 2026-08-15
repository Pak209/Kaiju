import type { SceneEntry } from "./types";

export const normalizeBundlePath = (path: string) => {
  let normalized = path
    .replaceAll("\\", "/")
    .replace(/^holocity:\/\/bundle\//, "")
    .replace(/^\.\//, "");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Preserve malformed-but-valid local filenames verbatim.
  }
  const parts: string[] = [];
  for (const part of normalized.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
};

export function createAssetIndex(files: Map<string, File>) {
  const paths = [...files.keys()].filter((path) =>
    path.toLowerCase().endsWith(".glb"),
  );
  const byPath = new Map(
    paths.map((path) => [normalizeBundlePath(path).toLowerCase(), path]),
  );
  const byBasename = new Map<string, string>();
  for (const path of paths) {
    const basename = normalizeBundlePath(path).split("/").pop()!.toLowerCase();
    if (!byBasename.has(basename)) byBasename.set(basename, path);
  }
  return { paths, byPath, byBasename };
}

export function resolveSceneGlb(
  entry: SceneEntry,
  index: ReturnType<typeof createAssetIndex>,
) {
  if (entry.glb) return normalizeBundlePath(entry.glb);
  const prefabStem = entry.prefabPath
    ?.split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "");
  const candidates = [
    `${entry.name}.glb`,
    prefabStem ? `${prefabStem}.glb` : "",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const exact = index.byPath.get(`glb/${candidate}`.toLowerCase());
    if (exact) return exact;
    const basename = index.byBasename.get(candidate.toLowerCase());
    if (basename) return basename;
  }
  return undefined;
}

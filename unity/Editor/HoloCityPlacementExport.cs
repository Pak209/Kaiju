using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Holobots.EditorTools.Placement
{
    /// <summary>
    /// U1 — exports a HoloCity scene for the HolocityPlacer web editor.
    ///
    /// Emits `scene_export.json` (holocity.scene-export 1.0.0), `palette.json`
    /// (holocity.palette 1.0.0) and, once glTFast is approved, one GLB per
    /// distinct prefab. Transforms are UNITY-SPACE throughout — left-handed,
    /// Y-up, metres, quaternion xyzw. The web editor converts for display and
    /// must convert back losslessly; nothing is converted on this side.
    ///
    /// EDITABLE IS DECIDED STRUCTURALLY, NOT BY NAME. An entry is editable only
    /// if every component on it and its children is in <see cref="EditableComponents"/>.
    /// Anything script-bearing, anything with a Terrain, anything procedural is
    /// exported as LOCKED CONTEXT: it renders in the browser for occlusion and
    /// spatial reference, is never selectable, and can never appear in a diff.
    /// That rule is the defence against locked-entry leakage (package §9), and
    /// it is deliberately a whitelist — a new component type defaults to LOCKED
    /// rather than silently becoming editable.
    ///
    /// OUTPUT GOES TO A LOCAL, GITIGNORED FOLDER BY DEFAULT. Bundles derive from
    /// purchased packs, so they must never be committed to this repo (the
    /// packs-never-committed rule) nor to the HolocityPlacer repo, which may be
    /// pushed — redistributing store assets is a licence line we do not cross.
    ///
    /// Menu: Holobots ▸ HoloCity ▸ Placement ▸ Export …
    /// </summary>
    public static class HoloCityPlacementExport
    {
        public const string SchemaVersion = "1.1.0";
        private const string DefaultOutputRoot = "PlacerBundles";   // under ~/HolobotsVault

        /// <summary>
        /// The ONLY components an editable instance may carry. Whitelist, not
        /// blacklist: an unknown component means locked.
        /// </summary>
        private static readonly System.Type[] EditableComponents =
        {
            typeof(Transform),
            typeof(MeshFilter),
            typeof(MeshRenderer),
            typeof(LODGroup),
            typeof(Collider),          // covers Box/Sphere/Capsule/Mesh colliders
        };

        /// <summary>
        /// Palette exclusions that are RULINGS, not technical limits, so they
        /// live here where they can be read rather than buried in a filter.
        /// </summary>
        private static readonly string[] PaletteExcludedPathFragments =
        {
            "Meshy_Pine",   // city keeps its approved concept trees; Meshy pine/willow
            "Meshy_Willow", // are Neon-Forest-only (holocity-trees-are-not-meshy)
            "StylizedWater3",
        };

        // ---------------------------------------------------------------- menu

        [MenuItem("Holobots/HoloCity/Placement/Export Selection…", true)]
        private static bool ValidateSelection() => Selection.gameObjects.Length > 0;

        [MenuItem("Holobots/HoloCity/Placement/Export Selection…")]
        public static void ExportSelection() => Export(Selection.gameObjects, "district");

        [MenuItem("Holobots/HoloCity/Placement/Export Whole Town…")]
        public static void ExportWholeTown()
        {
            var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            var roots = new List<GameObject>();
            foreach (var r in scene.GetRootGameObjects()) roots.Add(r);
            Export(roots.ToArray(), "whole");
        }

        /// <summary>
        /// The current scene's baseHash, computed by exactly the path the export
        /// uses. The importer calls THIS rather than reimplementing the hash —
        /// two implementations that must agree forever are a bug waiting to
        /// happen, and the failure would look like a bad diff rather than drift.
        /// </summary>
        public static string CurrentBaseHash()
        {
            var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            var entries = new List<Entry>();
            var seen = new HashSet<Transform>();
            var vsets = HoloCityVariantSet.ByPrefabPath();   // once, not once per root
            foreach (var r in scene.GetRootGameObjects()) CollectFrom(r.transform, entries, seen, null, vsets);
            entries.Sort((a, b) => string.CompareOrdinal(a.id, b.id));
            return Sha256(EntriesJson(entries));
        }

        /// <summary>Editability test, shared with the importer so both agree by construction.</summary>
        public static bool IsEditable(GameObject go) => IsEditableInstance(go, out _);

        // -------------------------------------------------------------- export

        private static void Export(GameObject[] roots, string exportMode)
        {
            var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            string outDir = OutputDir(scene.name);
            System.IO.Directory.CreateDirectory(outDir);

            var entries = new List<Entry>();
            var seen = new HashSet<Transform>();
            var vsets = HoloCityVariantSet.ByPrefabPath();   // once, not once per root
            foreach (var root in roots)
            {
                if (root == null) continue;
                CollectFrom(root.transform, entries, seen, null, vsets);
            }

            // Deterministic order: the baseHash must be stable across runs on an
            // unchanged scene, so sort before hashing rather than relying on
            // scene traversal order.
            entries.Sort((a, b) => string.CompareOrdinal(a.id, b.id));

            string entriesJson = EntriesJson(entries);
            string baseHash = Sha256(entriesJson);

            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"schemaVersion\": \"").Append(SchemaVersion).Append("\",\n");
            sb.Append("  \"kind\": \"holocity.scene-export\",\n");
            sb.Append("  \"sceneName\": ").Append(Str(scene.name)).Append(",\n");
            sb.Append("  \"unityScenePath\": ").Append(Str(scene.path)).Append(",\n");
            sb.Append("  \"exportedAt\": ").Append(Str(System.DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture))).Append(",\n");
            sb.Append("  \"exportMode\": ").Append(Str(exportMode)).Append(",\n");
            sb.Append("  \"baseHash\": ").Append(Str(baseHash)).Append(",\n");
            sb.Append("  \"entries\": ").Append(entriesJson).Append("\n");
            sb.Append("}\n");

            string scenePath = System.IO.Path.Combine(outDir, "scene_export.json");
            System.IO.File.WriteAllText(scenePath, sb.ToString());

            int palette = WritePalette(outDir);

            // GLBs run ASYNCHRONOUSLY over following editor frames — see
            // HoloCityGlbExporter for why blocking here deadlocks the editor.
            // The JSON below is already complete and valid on disk, so the
            // bundle is usable (placement data, no geometry) even if GLBs fail.
            var glbWanted = new HashSet<string>();
            foreach (var e in entries)
                if (!string.IsNullOrEmpty(e.prefabPath)) glbWanted.Add(e.prefabPath);
            foreach (var p in PalettePrefabPaths()) glbWanted.Add(p);

            int editable = entries.Count(e => e.editable);
            Debug.Log($"[PlacementExport] {exportMode}: {entries.Count} entries "
                      + $"({editable} editable, {entries.Count - editable} locked context), "
                      + $"{palette} palette items.\n  baseHash {baseHash}\n  -> {outDir}\n"
                      + $"  JSON complete. Starting {glbWanted.Count} GLB export(s) asynchronously…");

            HoloCityGlbExporter.Run(glbWanted, System.IO.Path.Combine(outDir, "glb"),
                (written, failed) =>
                {
                    Debug.Log($"[PlacementExport] BUNDLE READY: {written} GLB(s) written, "
                              + $"{failed.Count} failed.\n  -> {outDir}");
                    EditorUtility.RevealInFinder(scenePath);
                });
        }

        /// <summary>
        /// Walks the hierarchy, emitting the OUTERMOST editable instances and
        /// otherwise recording locked context. Once an object qualifies as an
        /// editable instance its children are not walked separately — the diff
        /// moves whole instances, not their parts.
        /// </summary>
        private static void CollectFrom(Transform t, List<Entry> outp, HashSet<Transform> seen,
                                        string parentEntryId = null,
                                        Dictionary<string, HoloCityVariantSet> variantSets = null)
        {
            if (t == null || !seen.Add(t)) return;
            if (!t.gameObject.activeInHierarchy) return;

            variantSets ??= HoloCityVariantSet.ByPrefabPath();

            bool renders = t.GetComponentInChildren<Renderer>(false) != null
                           || t.GetComponent<Terrain>() != null;

            string myEntryId = parentEntryId;
            if (renders)
            {
                bool editable = IsEditableInstance(t.gameObject, out string prefabPath);
                string id = GlobalObjectId.GetGlobalObjectIdSlow(t.gameObject).ToString();

                // Which palette variant is live on this instance, so the web
                // editor diffs material changes against reality rather than
                // assuming everything starts at the prefab default.
                string variant = null;
                if (editable && prefabPath != null && variantSets.TryGetValue(prefabPath, out var set))
                    variant = set.CurrentKey(t.gameObject);

                outp.Add(new Entry
                {
                    id = id,
                    name = t.name,
                    // Nearest ANCESTOR ENTRY, not the raw transform parent —
                    // intermediate grouping objects that render nothing are
                    // not entries, and a parentId pointing at a non-entry
                    // would be undiffable on the web side.
                    parentId = parentEntryId,
                    prefabPath = prefabPath,
                    kitFamily = KitFamilyOf(prefabPath),
                    editable = editable,
                    pos = t.position,
                    rot = t.rotation,
                    scale = t.lossyScale,
                    bounds = BoundsSizeOf(t),
                    // activeSelf, not activeInHierarchy: an entry only appears
                    // here at all if the hierarchy is active, so activeSelf is
                    // the part this object owns.
                    active = t.gameObject.activeSelf,
                    layer = LayerMask.LayerToName(t.gameObject.layer),
                    tag = t.gameObject.tag,
                    staticFlags = GameObjectUtility.GetStaticEditorFlags(t.gameObject),
                    materialVariant = variant,
                });
                if (editable) return;   // whole instance emitted; do not descend
                myEntryId = id;         // locked context can still parent entries below it
            }

            for (int i = 0; i < t.childCount; i++)
                CollectFrom(t.GetChild(i), outp, seen, myEntryId, variantSets);
        }

        /// <summary>
        /// Structural editability test. Must be a prefab instance, and every
        /// component in its subtree must be whitelisted.
        /// </summary>
        private static bool IsEditableInstance(GameObject go, out string prefabPath)
        {
            prefabPath = null;
            if (!PrefabUtility.IsPartOfPrefabInstance(go)) return false;
            if (PrefabUtility.GetOutermostPrefabInstanceRoot(go) != go) return false;

            var source = PrefabUtility.GetCorrespondingObjectFromOriginalSource(go);
            if (source == null) return false;
            prefabPath = AssetDatabase.GetAssetPath(source);
            if (string.IsNullOrEmpty(prefabPath)) return false;

            foreach (var c in go.GetComponentsInChildren<Component>(true))
            {
                if (c == null) return false;                 // missing script -> locked
                var ct = c.GetType();
                bool ok = false;
                foreach (var alw in EditableComponents)
                    if (alw.IsAssignableFrom(ct)) { ok = true; break; }
                if (!ok) return false;
            }
            return true;
        }

        private static Vector3 BoundsSizeOf(Transform t)
        {
            var rs = t.GetComponentsInChildren<Renderer>(true);
            if (rs.Length == 0) return Vector3.zero;
            var b = rs[0].bounds;
            foreach (var r in rs) b.Encapsulate(r.bounds);
            return b.size;
        }

        private static string KitFamilyOf(string prefabPath)
        {
            if (string.IsNullOrEmpty(prefabPath)) return null;
            var parts = prefabPath.Split('/');
            for (int i = 0; i < parts.Length - 1; i++)
                if (parts[i] == "Kits" && i + 1 < parts.Length) return parts[i + 1];
            return parts.Length >= 2 ? parts[parts.Length - 2] : null;
        }

        // ------------------------------------------------------------- palette

        private static int WritePalette(string outDir)
        {
            var items = new List<string>();
            var variantSets = HoloCityVariantSet.ByPrefabPath();
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/HoloCity/Kits" }))
            {
                string p = AssetDatabase.GUIDToAssetPath(guid);
                if (PaletteExcludedPathFragments.Any(x => p.Contains(x))) continue;
                var go = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                if (go == null) continue;

                // Same structural rule as the scene side: script-bearing prefabs
                // are not placeable, because the importer only instantiates and
                // cannot reason about what a script would do.
                bool clean = true;
                foreach (var c in go.GetComponentsInChildren<Component>(true))
                {
                    if (c == null) { clean = false; break; }
                    bool ok = EditableComponents.Any(a => a.IsAssignableFrom(c.GetType()));
                    if (!ok) { clean = false; break; }
                }
                if (!clean) continue;
                if (go.GetComponentInChildren<Renderer>(true) == null) continue;

                var rot = go.transform.rotation;   // kit axis-fix lives here — the web
                                                   // editor SEEDS with it and stores the
                                                   // absolute; nobody composes it again
                var s = go.transform.localScale;

                string variantsJson = "[]";
                if (variantSets.TryGetValue(p, out var set) && set.variants != null)
                {
                    var vs = set.variants
                        .Where(v => v != null && !string.IsNullOrEmpty(v.key))
                        .Select(v => "\n        {"
                            + " \"key\": " + Str(v.key) + ","
                            + " \"displayName\": " + Str(string.IsNullOrEmpty(v.displayName) ? v.key : v.displayName) + ","
                            + " \"swatch\": " + Str("#" + ColorUtility.ToHtmlStringRGB(v.swatch))
                            + " }")
                        .ToList();
                    if (vs.Count > 0) variantsJson = "[" + string.Join(",", vs) + "\n      ]";
                }

                items.Add("    {\n"
                    + "      \"prefabPath\": " + Str(p) + ",\n"
                    + "      \"displayName\": " + Str(go.name) + ",\n"
                    + "      \"kitFamily\": " + Str(KitFamilyOf(p) ?? "") + ",\n"
                    + "      \"glb\": " + Str("glb/" + go.name + ".glb") + ",\n"
                    + "      \"defaultScale\": " + Vec3(s) + ",\n"
                    + "      \"defaultRotation\": " + Quat(rot) + ",\n"
                    + "      \"materialVariants\": " + variantsJson + "\n"
                    + "    }");
            }
            items.Sort(System.StringComparer.Ordinal);

            var sb = new StringBuilder();
            sb.Append("{\n  \"schemaVersion\": \"").Append(SchemaVersion).Append("\",\n");
            sb.Append("  \"kind\": \"holocity.palette\",\n");
            sb.Append("  \"items\": [\n").Append(string.Join(",\n", items)).Append("\n  ]\n}\n");
            System.IO.File.WriteAllText(System.IO.Path.Combine(outDir, "palette.json"), sb.ToString());
            return items.Count;
        }

        // --------------------------------------------------------------- glTF
        //
        // GLB export lives in HoloCityGlbExporter, driven from Export() above.
        //
        // The synchronous implementation that used to sit here was removed. It
        // blocked the main thread on glTFast's Task via GetAwaiter().GetResult(),
        // and that Task needs the main thread to progress — it deadlocked the
        // editor twice on 2026-08-02, force-quit both times. It had been left
        // in place behind an early `return` with a DISABLED banner, which by
        // now was worse than gone: the banner claimed GLB export was off long
        // after the async rewrite landed and started working.
        //
        // One GLB per DISTINCT PREFAB, exported at IDENTITY. A town with 40
        // copies of a wall ships one wall mesh and 40 transforms; the manifest
        // carries each instance's world transform and the palette carries the
        // prefab's own default rotation, so baking either into the GLB would
        // apply it twice.

        private static List<string> PalettePrefabPaths()
        {
            var outp = new List<string>();
            foreach (var guid in AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/HoloCity/Kits" }))
            {
                string p = AssetDatabase.GUIDToAssetPath(guid);
                if (PaletteExcludedPathFragments.Any(x => p.Contains(x))) continue;
                var go = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                if (go == null || go.GetComponentInChildren<Renderer>(true) == null) continue;
                bool clean = true;
                foreach (var c in go.GetComponentsInChildren<Component>(true))
                {
                    if (c == null) { clean = false; break; }
                    if (!EditableComponents.Any(a => a.IsAssignableFrom(c.GetType()))) { clean = false; break; }
                }
                if (clean) outp.Add(p);
            }
            return outp;
        }

        // --------------------------------------------------------------- json

        private sealed class Entry
        {
            public string id, name, parentId, prefabPath, kitFamily;
            public bool editable;
            public Vector3 pos, scale, bounds;
            public Quaternion rot;
            public bool active;
            public string layer, tag, materialVariant;
            public StaticEditorFlags staticFlags;
        }

        /// <summary>
        /// StaticEditorFlags by NAME. The numeric values are Unity's own
        /// business; a name that stops existing fails loudly on import, where
        /// a stale bit silently becomes a different flag.
        /// </summary>
        private static string StaticFlagsJson(StaticEditorFlags f)
        {
            var names = new List<string>();
            foreach (StaticEditorFlags v in System.Enum.GetValues(typeof(StaticEditorFlags)))
                if (v != 0 && (f & v) == v) names.Add("\"" + v + "\"");
            return "[" + string.Join(", ", names) + "]";
        }

        private static string EntriesJson(List<Entry> entries)
        {
            var parts = new List<string>(entries.Count);
            foreach (var e in entries)
            {
                var sb = new StringBuilder();
                sb.Append("    {\n");
                sb.Append("      \"id\": ").Append(Str(e.id)).Append(",\n");
                sb.Append("      \"name\": ").Append(Str(e.name)).Append(",\n");
                if (!string.IsNullOrEmpty(e.parentId))
                    sb.Append("      \"parentId\": ").Append(Str(e.parentId)).Append(",\n");
                if (!string.IsNullOrEmpty(e.prefabPath))
                    sb.Append("      \"prefabPath\": ").Append(Str(e.prefabPath)).Append(",\n");
                if (!string.IsNullOrEmpty(e.kitFamily))
                    sb.Append("      \"kitFamily\": ").Append(Str(e.kitFamily)).Append(",\n");
                sb.Append("      \"editable\": ").Append(e.editable ? "true" : "false").Append(",\n");
                sb.Append("      \"transform\": {\n");
                sb.Append("        \"position\": ").Append(Vec3(e.pos)).Append(",\n");
                sb.Append("        \"rotation\": ").Append(Quat(e.rot)).Append(",\n");
                sb.Append("        \"scale\": ").Append(Vec3(e.scale)).Append("\n");
                sb.Append("      },\n");
                sb.Append("      \"state\": {\n");
                sb.Append("        \"active\": ").Append(e.active ? "true" : "false").Append(",\n");
                sb.Append("        \"layer\": ").Append(Str(e.layer)).Append(",\n");
                sb.Append("        \"tag\": ").Append(Str(e.tag)).Append(",\n");
                sb.Append("        \"staticFlags\": ").Append(StaticFlagsJson(e.staticFlags)).Append(",\n");
                sb.Append("        \"materialVariant\": ").Append(e.materialVariant == null ? "null" : Str(e.materialVariant)).Append("\n");
                sb.Append("      },\n");
                sb.Append("      \"boundsSize\": ").Append(Vec3(e.bounds)).Append("\n");
                sb.Append("    }");
                parts.Add(sb.ToString());
            }
            return "[\n" + string.Join(",\n", parts) + "\n  ]";
        }

        /// <summary>
        /// Fixed 6-decimal invariant formatting. Float round-tripping is the
        /// obvious way for baseHash to differ between two identical scenes, so
        /// precision is pinned rather than left to the default formatter.
        /// </summary>
        private static string F(float v) =>
            (Mathf.Abs(v) < 1e-6f ? 0f : v).ToString("0.000000", CultureInfo.InvariantCulture);

        private static string Vec3(Vector3 v) => "[" + F(v.x) + ", " + F(v.y) + ", " + F(v.z) + "]";
        private static string Quat(Quaternion q) => "[" + F(q.x) + ", " + F(q.y) + ", " + F(q.z) + ", " + F(q.w) + "]";
        private static string Str(string s) => "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        private static string Sha256(string s)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var h = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder(h.Length * 2);
                foreach (var b in h) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        private static string OutputDir(string sceneName)
        {
            string home = System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile);
            return System.IO.Path.Combine(home, "HolobotsVault", DefaultOutputRoot, sceneName);
        }
    }
}

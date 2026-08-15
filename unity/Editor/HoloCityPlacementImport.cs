using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Holobots.EditorTools.Placement
{
    /// <summary>
    /// U2 — imports a placement diff from the HolocityPlacer web editor.
    ///
    /// NOTHING IS APPLIED WITHOUT A DRY RUN. Loading a diff only ever produces a
    /// report; a human reads it and presses Apply. Every apply is one Undo step.
    ///
    /// The validation chain refuses rather than repairs. A diff that fails any
    /// check is reported with the reason and the offending entry, because the
    /// interesting failures here — a stale session, a mirrored handedness
    /// conversion, a locked entry that leaked into the editable set — all
    /// produce plausible-looking transforms. Silently importing a plausible
    /// wrong number is the worst outcome available, so entries fail loudly and
    /// individually; a partial apply of the valid remainder is offered but never
    /// automatic.
    ///
    /// Menu: Holobots ▸ HoloCity ▸ Placement ▸ Import Placement Diff…
    /// </summary>
    public sealed class HoloCityPlacementImport : EditorWindow
    {
        // ------------------------------------------------------- diff payload

        [System.Serializable] private sealed class Xform
        {
            public float[] position, rotation, scale;
            public Vector3 Pos => new Vector3(position[0], position[1], position[2]);
            public Quaternion Rot => new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);
            public Vector3 Scale => new Vector3(scale[0], scale[1], scale[2]);
            public bool Shaped => position != null && position.Length == 3
                               && rotation != null && rotation.Length == 4
                               && scale != null && scale.Length == 3;
        }

        [System.Serializable] private sealed class ModEntry { public string id; public Xform transform, priorTransform; }
        [System.Serializable] private sealed class AddEntry { public string tempId, prefabPath; public Xform transform; }
        [System.Serializable] private sealed class DelEntry { public string id; public Xform priorTransform; }

        [System.Serializable] private sealed class Diff
        {
            public string schemaVersion, kind, sceneName, baseHash, createdAt;
            public ModEntry[] modified;
            public AddEntry[] added;
            public DelEntry[] deleted;
        }

        // ----------------------------------------------------------- findings

        private enum Verdict { Ok, Refused }

        private sealed class Row
        {
            public string op, subject, detail;
            public Verdict verdict;
            public System.Action apply;
        }

        private readonly List<Row> _rows = new List<Row>();
        private readonly List<string> _fatal = new List<string>();
        private string _path, _summary;
        private Vector2 _scroll;

        /// <summary>Position sanity bound. A town-scale scene; anything beyond this is a unit or handedness bug.</summary>
        private const float MaxAbsPosition = 2000f;
        private const float MinAbsScale = 0.001f, MaxAbsScale = 1000f;
        /// <summary>priorTransform match tolerance. Generous enough for float round-trip, tight enough to catch a real edit.</summary>
        private const float PriorPosEpsilon = 0.001f;
        private const float PriorRotEpsilonDeg = 0.1f;

        [MenuItem("Holobots/HoloCity/Placement/Import Placement Diff…")]
        public static void Open()
        {
            var w = GetWindow<HoloCityPlacementImport>(true, "Import Placement Diff", true);
            w.minSize = new Vector2(760, 520);
            w.Show();
            w.Load();
        }

        private void Load()
        {
            _rows.Clear(); _fatal.Clear(); _summary = null;
            string home = System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile);
            _path = EditorUtility.OpenFilePanel("Placement diff",
                System.IO.Path.Combine(home, "HolobotsVault", "PlacerBundles"), "json");
            if (string.IsNullOrEmpty(_path)) { Close(); return; }
            DryRun();
        }

        // ---------------------------------------------------------- dry run

        private void DryRun()
        {
            Diff d;
            try { d = JsonUtility.FromJson<Diff>(System.IO.File.ReadAllText(_path)); }
            catch (System.Exception ex) { _fatal.Add("Could not parse JSON: " + ex.Message); return; }
            if (d == null) { _fatal.Add("Could not parse JSON: empty document."); return; }

            // --- document-level gates. Any of these means the whole diff is refused.
            if (d.kind != "holocity.placement-diff")
                _fatal.Add("kind is '" + (d.kind ?? "<null>") + "', expected holocity.placement-diff.");
            if (d.schemaVersion != HoloCityPlacementExport.SchemaVersion)
                _fatal.Add("schemaVersion is '" + (d.schemaVersion ?? "<null>") + "', this Unity build speaks "
                           + HoloCityPlacementExport.SchemaVersion + ".");

            var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            if (d.sceneName != scene.name)
                _fatal.Add("diff targets scene '" + d.sceneName + "' but '" + scene.name + "' is open.");

            if (_fatal.Count == 0)
            {
                string live = HoloCityPlacementExport.CurrentBaseHash();
                if (live != d.baseHash)
                    _fatal.Add("STALE SESSION — baseHash mismatch.\n    diff was built against " + Short(d.baseHash)
                               + "\n    scene now hashes to      " + Short(live)
                               + "\n    The scene changed after the export. Re-export, redo the placement, or "
                               + "accept losing this session's work — this importer will not guess which "
                               + "version is right.");
            }
            if (_fatal.Count > 0) return;

            var palette = PalettePaths();

            foreach (var m in d.modified ?? new ModEntry[0]) Check(m, palette);
            foreach (var a in d.added ?? new AddEntry[0]) Check(a, palette);
            foreach (var x in d.deleted ?? new DelEntry[0]) Check(x);

            int ok = _rows.Count(r => r.verdict == Verdict.Ok);
            _summary = _rows.Count + " change(s): " + ok + " will apply, " + (_rows.Count - ok) + " refused.";
        }

        private void Check(ModEntry m, HashSet<string> palette)
        {
            var row = new Row { op = "MODIFY", subject = m.id };
            _rows.Add(row);
            if (m.transform == null || !m.transform.Shaped || m.priorTransform == null || !m.priorTransform.Shaped)
            { Refuse(row, "malformed transform."); return; }

            var go = Resolve(m.id);
            if (go == null) { Refuse(row, "id does not resolve in this scene."); return; }
            row.subject = go.name;

            if (!HoloCityPlacementExport.IsEditable(go))
            { Refuse(row, "NOT EDITABLE — this is locked context and must never appear in a diff."); return; }

            string sane = Sanity(m.transform);
            if (sane != null) { Refuse(row, sane); return; }

            // Conflict check: has the scene moved under the session?
            float dp = Vector3.Distance(go.transform.position, m.priorTransform.Pos);
            float dr = Quaternion.Angle(go.transform.rotation, m.priorTransform.Rot);
            if (dp > PriorPosEpsilon || dr > PriorRotEpsilonDeg)
            {
                Refuse(row, "CONFLICT — the object moved in Unity after the export.\n"
                    + "        scene is at " + go.transform.position.ToString("F3")
                    + ", diff expected " + m.priorTransform.Pos.ToString("F3")
                    + " (off by " + dp.ToString("F3") + "m, " + dr.ToString("F1") + "deg)");
                return;
            }

            var t = go.transform;
            var p = m.transform.Pos; var r = m.transform.Rot; var s = m.transform.Scale;
            row.detail = "move " + dp.ToString("F2") + "m -> " + p.ToString("F2");
            row.apply = () => { Undo.RecordObject(t, "Import placement"); t.SetPositionAndRotation(p, r); t.localScale = s; };
        }

        private void Check(AddEntry a, HashSet<string> palette)
        {
            var row = new Row { op = "ADD", subject = a.prefabPath };
            _rows.Add(row);
            if (a.transform == null || !a.transform.Shaped) { Refuse(row, "malformed transform."); return; }
            if (string.IsNullOrEmpty(a.prefabPath) || !palette.Contains(a.prefabPath))
            { Refuse(row, "NOT IN PALETTE — the importer only instantiates palette prefabs, never arbitrary paths."); return; }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(a.prefabPath);
            if (prefab == null) { Refuse(row, "prefab missing from the project."); return; }

            string sane = Sanity(a.transform);
            if (sane != null) { Refuse(row, sane); return; }

            var pos = a.transform.Pos; var rot = a.transform.Rot; var scl = a.transform.Scale;
            row.detail = "instantiate at " + pos.ToString("F2");
            row.apply = () =>
            {
                var inst = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                inst.transform.position = pos;
                // COMPOSE with the prefab's default root rotation. Kit prefabs carry
                // their axis fix on the root — 110 of 119 palette items in the first
                // real export had a non-identity default — so overwriting would land
                // almost every placement wrong, and wrong in a way that reads as a
                // modelling fault rather than an import bug.
                inst.transform.rotation = rot * prefab.transform.rotation;
                inst.transform.localScale = scl;
                inst.name = prefab.name + "_wp" + NextIndex(prefab.name).ToString("D3");
                Undo.RegisterCreatedObjectUndo(inst, "Import placement");
            };
        }

        private void Check(DelEntry x)
        {
            var row = new Row { op = "DELETE", subject = x.id };
            _rows.Add(row);
            var go = Resolve(x.id);
            if (go == null) { Refuse(row, "id does not resolve in this scene."); return; }
            row.subject = go.name;
            if (!HoloCityPlacementExport.IsEditable(go))
            { Refuse(row, "NOT EDITABLE — locked context cannot be deleted through a diff."); return; }
            if (x.priorTransform != null && x.priorTransform.Shaped)
            {
                float dp = Vector3.Distance(go.transform.position, x.priorTransform.Pos);
                if (dp > PriorPosEpsilon)
                { Refuse(row, "CONFLICT — moved in Unity after the export (off by " + dp.ToString("F3") + "m)."); return; }
            }
            row.detail = "delete";
            row.apply = () => Undo.DestroyObjectImmediate(go);
        }

        // --------------------------------------------------------- helpers

        private static string Sanity(Xform x)
        {
            foreach (var v in x.position.Concat(x.rotation).Concat(x.scale))
                if (float.IsNaN(v) || float.IsInfinity(v)) return "NaN or infinity in the transform.";
            var p = x.Pos;
            if (Mathf.Abs(p.x) > MaxAbsPosition || Mathf.Abs(p.y) > MaxAbsPosition || Mathf.Abs(p.z) > MaxAbsPosition)
                return "position " + p.ToString("F1") + " is outside +/-" + MaxAbsPosition
                     + "m — likely a unit or handedness error rather than a real placement.";
            var s = x.Scale;
            foreach (var c in new[] { s.x, s.y, s.z })
                if (Mathf.Abs(c) < MinAbsScale || Mathf.Abs(c) > MaxAbsScale)
                    return "scale " + s.ToString("F3") + " is outside sane bounds.";
            return null;
        }

        private static void Refuse(Row r, string why) { r.verdict = Verdict.Refused; r.detail = why; }

        private static GameObject Resolve(string globalObjectId)
        {
            if (!GlobalObjectId.TryParse(globalObjectId, out var gid)) return null;
            return GlobalObjectId.GlobalObjectIdentifierToObjectSlow(gid) as GameObject;
        }

        private static HashSet<string> PalettePaths()
        {
            // The palette beside the diff is the authority the web editor was given.
            var set = new HashSet<string>();
            try
            {
                string pal = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(
                    EditorPrefs.GetString("HB_Placer_LastDiff", "")) ?? "", "palette.json");
                if (!System.IO.File.Exists(pal)) return PaletteFromProject();
                foreach (var line in System.IO.File.ReadAllLines(pal))
                {
                    int i = line.IndexOf("\"prefabPath\"");
                    if (i < 0) continue;
                    int a = line.IndexOf('"', line.IndexOf(':', i)) + 1;
                    int b = line.IndexOf('"', a);
                    if (a > 0 && b > a) set.Add(line.Substring(a, b - a));
                }
            }
            catch { /* fall through */ }
            return set.Count > 0 ? set : PaletteFromProject();
        }

        private static HashSet<string> PaletteFromProject()
        {
            var set = new HashSet<string>();
            foreach (var g in AssetDatabase.FindAssets("t:Prefab", new[] { "Assets/HoloCity/Kits" }))
                set.Add(AssetDatabase.GUIDToAssetPath(g));
            return set;
        }

        private static int NextIndex(string prefabName)
        {
            int max = 0;
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None))
            {
                if (t == null || !t.name.StartsWith(prefabName + "_wp")) continue;
                if (int.TryParse(t.name.Substring((prefabName + "_wp").Length), out int n) && n > max) max = n;
            }
            return max + 1;
        }

        private static string Short(string h) => string.IsNullOrEmpty(h) ? "<null>" : h.Substring(0, System.Math.Min(16, h.Length));

        // -------------------------------------------------------------- ui

        private void OnGUI()
        {
            EditorGUILayout.LabelField(System.IO.Path.GetFileName(_path ?? ""), EditorStyles.boldLabel);

            if (_fatal.Count > 0)
            {
                EditorGUILayout.HelpBox("DIFF REFUSED — nothing will be applied.\n\n"
                    + string.Join("\n\n", _fatal), MessageType.Error);
                if (GUILayout.Button("Close")) Close();
                return;
            }

            EditorGUILayout.HelpBox(_summary ?? "", MessageType.Info);
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            foreach (var r in _rows)
            {
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    using (new EditorGUILayout.HorizontalScope())
                    {
                        var c = GUI.color;
                        GUI.color = r.verdict == Verdict.Ok ? new Color(0.6f, 1f, 0.6f) : new Color(1f, 0.6f, 0.6f);
                        GUILayout.Label(r.verdict == Verdict.Ok ? "APPLY " : "REFUSE", EditorStyles.boldLabel, GUILayout.Width(60));
                        GUI.color = c;
                        GUILayout.Label(r.op, EditorStyles.miniBoldLabel, GUILayout.Width(60));
                        GUILayout.Label(r.subject, EditorStyles.label);
                    }
                    if (!string.IsNullOrEmpty(r.detail))
                        EditorGUILayout.LabelField("    " + r.detail, EditorStyles.wordWrappedMiniLabel);
                }
            }
            EditorGUILayout.EndScrollView();

            int ok = _rows.Count(r => r.verdict == Verdict.Ok);
            int bad = _rows.Count - ok;
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(ok == 0))
                    if (GUILayout.Button(bad == 0 ? "Apply " + ok + " change(s)"
                                                  : "Apply the " + ok + " valid change(s), skip " + bad,
                                         GUILayout.Height(28))) Apply();
                if (GUILayout.Button("Cancel", GUILayout.Height(28), GUILayout.Width(100))) Close();
            }
        }

        private void Apply()
        {
            int group = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName("Import placement diff");
            int n = 0;
            foreach (var r in _rows) if (r.verdict == Verdict.Ok && r.apply != null) { r.apply(); n++; }
            Undo.CollapseUndoOperations(group);   // one Ctrl+Z undoes the whole import
            UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(
                UnityEngine.SceneManagement.SceneManager.GetActiveScene());
            Debug.Log("[PlacementImport] Applied " + n + " change(s) as a single undo step. Scene is dirty and NOT saved.");
            Close();
        }
    }
}

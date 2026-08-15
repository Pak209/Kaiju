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

        /// <summary>
        /// Non-transform state. JsonUtility cannot distinguish "absent" from
        /// "default", so raw JSON key presence is checked via <see cref="Has"/>
        /// — an absent key means "leave it alone" and that distinction is the
        /// contract (a diff must not stomp fields the session never touched).
        /// parentId uses a sentinel for the same reason: null is a meaningful
        /// value here (scene root), not an absence.
        /// </summary>
        [System.Serializable] private sealed class StateJson
        {
            public string parentId, layer, tag, materialVariant;
            public bool active;
            public string[] staticFlags;
        }

        [System.Serializable] private sealed class ModEntry
        {
            public string id;
            public Xform transform, priorTransform;
            public StateJson state, priorState;
            [System.NonSerialized] public HashSet<string> stateKeys, priorStateKeys;
            [System.NonSerialized] public bool parentIsNull, priorParentIsNull;
        }
        [System.Serializable] private sealed class AddEntry
        {
            public string tempId, prefabPath;
            public Xform transform;
            public StateJson state;
            [System.NonSerialized] public HashSet<string> stateKeys;
            [System.NonSerialized] public bool parentIsNull;
        }
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
            public bool conflict;      // refused specifically because the scene moved under the session
            public System.Action apply;
        }

        private readonly List<Row> _rows = new List<Row>();
        private readonly List<string> _fatal = new List<string>();
        private string _path, _summary, _staleBanner;
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
            // Newtonsoft rather than JsonUtility, because state semantics hang
            // on ABSENT vs PRESENT-WITH-DEFAULT-VALUE — "omit active" means
            // leave it alone while "active: false" is an instruction — and
            // JsonUtility cannot see the difference. The key sets captured
            // here are that distinction.
            Diff d;
            try
            {
                var root = Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(_path));
                d = root.ToObject<Diff>();
                CaptureStateKeys(root, d);
            }
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

            if (_fatal.Count > 0) return;

            // baseHash is a WARNING, not a gate.
            //
            // It hashes the whole scene, so it trips on any edit at all — a
            // light, a material, a terrain tweak by someone else. Making that
            // fatal meant you could not touch Unity while a browser session was
            // open, and a whole placement session died to an unrelated change.
            // That cost is real and the information gained is coarse.
            //
            // priorTransform already does this job per entry, and does it
            // precisely: it knows WHICH objects moved rather than THAT
            // something did. So the hash reports, and the per-entry check
            // decides. See ARCHITECTURE.md §3.
            string liveHash = HoloCityPlacementExport.CurrentBaseHash();
            bool stale = liveHash != d.baseHash;

            var palette = PalettePaths();

            foreach (var m in d.modified ?? new ModEntry[0]) Check(m, palette);
            foreach (var a in d.added ?? new AddEntry[0]) Check(a, palette);
            foreach (var x in d.deleted ?? new DelEntry[0]) Check(x);

            int ok = _rows.Count(r => r.verdict == Verdict.Ok);
            int conflicts = _rows.Count(r => r.conflict);
            _summary = _rows.Count + " change(s): " + ok + " will apply, " + (_rows.Count - ok) + " refused.";

            if (stale)
            {
                _staleBanner = "Scene changed since export — "
                    + conflicts + " of " + _rows.Count + " entries conflict.\n"
                    + (conflicts == 0
                        ? "None of this diff's objects were touched, so every entry above is still safe to apply."
                        : "The conflicting entries are refused individually and listed below. "
                          + "The rest are unaffected and can be applied.")
                    + "\n\nexported against " + Short(d.baseHash) + ", scene now " + Short(liveHash);
            }
        }

        private void Check(ModEntry m, HashSet<string> palette)
        {
            bool hasState = m.stateKeys != null && m.stateKeys.Count > 0;
            var row = new Row { op = hasState ? "MODIFY+" : "MODIFY", subject = m.id };
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
                row.conflict = true;
                Refuse(row, "CONFLICT — the object moved in Unity after the export.\n"
                    + "        scene is at " + go.transform.position.ToString("F3")
                    + ", diff expected " + m.priorTransform.Pos.ToString("F3")
                    + " (off by " + dp.ToString("F3") + "m, " + dr.ToString("F1") + "deg)");
                return;
            }

            System.Action<GameObject> applyState = null;
            if (hasState)
            {
                string ppath = null;
                var src = PrefabUtility.GetCorrespondingObjectFromOriginalSource(go);
                if (src != null) ppath = AssetDatabase.GetAssetPath(src);
                string err = CheckState(go, ppath, m.state, m.stateKeys, m.parentIsNull,
                                        m.priorState, m.priorStateKeys, out applyState, out bool conflict);
                if (err != null) { row.conflict = conflict; Refuse(row, err); return; }
            }

            var t = go.transform;
            var p = m.transform.Pos; var r = m.transform.Rot; var s = m.transform.Scale;
            row.detail = "move " + dp.ToString("F2") + "m -> " + p.ToString("F2")
                       + (hasState ? "  state[" + string.Join(", ", m.stateKeys.OrderBy(x => x)) + "]" : "");
            row.apply = () =>
            {
                Undo.RecordObject(t, "Import placement");
                t.SetPositionAndRotation(p, r);
                // WORLD IN, LOCAL OUT. The exporter writes lossyScale (world);
                // assigning it straight to localScale multiplies by the parent's
                // scale again, and it compounds every round trip. Invisible at
                // the root — where every fixture lives — and only reachable
                // because CollectFrom descends through locked context, so an
                // editable instance can sit under a scaled locked parent.
                //
                // ORDER: reparent (in applyState) runs AFTER the transform so
                // the world pose set here survives — SetTransformParent keeps
                // world position, and WorldToLocalScale is computed against
                // the CURRENT parent either way.
                t.localScale = WorldToLocalScale(t, s);
                applyState?.Invoke(go);
            };
        }

        private void Check(AddEntry a, HashSet<string> palette)
        {
            bool hasState = a.stateKeys != null && a.stateKeys.Count > 0;
            var row = new Row { op = hasState ? "ADD+" : "ADD", subject = a.prefabPath };
            _rows.Add(row);
            if (a.transform == null || !a.transform.Shaped) { Refuse(row, "malformed transform."); return; }
            if (string.IsNullOrEmpty(a.prefabPath) || !palette.Contains(a.prefabPath))
            { Refuse(row, "NOT IN PALETTE — the importer only instantiates palette prefabs, never arbitrary paths."); return; }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(a.prefabPath);
            if (prefab == null) { Refuse(row, "prefab missing from the project."); return; }

            string sane = Sanity(a.transform);
            if (sane != null) { Refuse(row, sane); return; }

            System.Action<GameObject> applyState = null;
            if (hasState)
            {
                // go is null: values are validated now, priors are skipped —
                // a new object has nothing to conflict with — and the steps
                // run against the instance created below.
                string err = CheckState(null, a.prefabPath, a.state, a.stateKeys, a.parentIsNull,
                                        null, null, out applyState, out _);
                if (err != null) { Refuse(row, err); return; }
            }

            var pos = a.transform.Pos; var rot = a.transform.Rot; var scl = a.transform.Scale;
            row.detail = "instantiate at " + pos.ToString("F2")
                       + (hasState ? "  state[" + string.Join(", ", a.stateKeys.OrderBy(x => x)) + "]" : "");
            row.apply = () =>
            {
                var inst = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                inst.transform.position = pos;
                // ASSIGN, DO NOT COMPOSE. Kit prefabs carry an axis fix on the
                // root (110 of 119 palette items are non-identity), and this
                // line used to multiply by it — but the web editor already
                // seeds an added item with palette.defaultRotation and stores
                // the total (src/core.ts addItem; nothing composes it again for
                // display). Composing here applied the axis fix TWICE, on ~92%
                // of adds, and the result reads as a modelling fault rather
                // than an import bug.
                //
                // Absolute-on-both-sides is now the declared rule — it is what
                // modified[] and scale already do. ARCHITECTURE.md §2.
                inst.transform.rotation = rot;
                inst.transform.localScale = WorldToLocalScale(inst.transform, scl);
                inst.name = prefab.name + "_wp" + NextIndex(prefab.name).ToString("D3");
                Undo.RegisterCreatedObjectUndo(inst, "Import placement");
                applyState?.Invoke(inst);
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
                {
                    row.conflict = true;
                    Refuse(row, "CONFLICT — moved in Unity after the export (off by " + dp.ToString("F3") + "m).");
                    return;
                }
            }
            row.detail = "-> " + TrashRootName + " (deactivated, recoverable)";
            row.apply = () => Trash(go);
        }

        // ------------------------------------------------------------- trash

        private const string TrashRootName = "_PlacerTrash";

        /// <summary>
        /// A diff delete DEACTIVATES AND REPARENTS; it does not destroy.
        ///
        /// Undo covers the session, but a domain reload ends the session and a
        /// destroyed object is then gone for good. Deletes arrive in batches
        /// from a browser session where they were cheap to make, so the one
        /// that turns out to be wrong is discovered later — after a reload,
        /// after a play-mode entry — which is exactly when Undo no longer
        /// helps. A deactivated root costs nothing and makes the mistake
        /// survivable.
        ///
        /// The trash root is stripped before a build the same way any editor-
        /// only scaffolding is; it is not shipped content.
        /// </summary>
        private static void Trash(GameObject go)
        {
            var scene = go.scene;
            Transform root = null;
            foreach (var r in scene.GetRootGameObjects())
                if (r.name == TrashRootName) { root = r.transform; break; }

            if (root == null)
            {
                var created = new GameObject(TrashRootName);
                UnityEngine.SceneManagement.SceneManager.MoveGameObjectToScene(created, scene);
                created.SetActive(false);
                Undo.RegisterCreatedObjectUndo(created, "Import placement");
                root = created.transform;
            }

            // Keep the world transform so a recovered object lands back where it
            // was, rather than wherever the trash root happens to sit.
            Undo.SetTransformParent(go.transform, root, "Import placement");
            go.transform.SetParent(root, true);
            Undo.RecordObject(go, "Import placement");
            go.SetActive(false);
        }

        // ----------------------------------------------------------- state

        private static void CaptureStateKeys(Newtonsoft.Json.Linq.JObject root, Diff d)
        {
            System.Func<Newtonsoft.Json.Linq.JToken, string, (HashSet<string>, bool)> keysOf = (tok, name) =>
            {
                var o = tok?[name] as Newtonsoft.Json.Linq.JObject;
                if (o == null) return (null, false);
                var keys = new HashSet<string>(o.Properties().Select(p => p.Name));
                bool parentNull = o.TryGetValue("parentId", out var pv)
                                  && pv.Type == Newtonsoft.Json.Linq.JTokenType.Null;
                return (keys, parentNull);
            };

            var mods = root["modified"] as Newtonsoft.Json.Linq.JArray;
            for (int i = 0; mods != null && i < mods.Count && i < (d.modified?.Length ?? 0); i++)
            {
                (d.modified[i].stateKeys, d.modified[i].parentIsNull) = keysOf(mods[i], "state");
                (d.modified[i].priorStateKeys, d.modified[i].priorParentIsNull) = keysOf(mods[i], "priorState");
            }
            var adds = root["added"] as Newtonsoft.Json.Linq.JArray;
            for (int i = 0; adds != null && i < adds.Count && i < (d.added?.Length ?? 0); i++)
                (d.added[i].stateKeys, d.added[i].parentIsNull) = keysOf(adds[i], "state");
        }

        /// <summary>
        /// Validates one entry's state block and builds its apply step.
        /// Returns null on success; otherwise the refusal reason, with
        /// <paramref name="conflict"/> set when the reason is that the scene
        /// moved under the session (as opposed to a bad value).
        ///
        /// For modified entries every key present in `state` must also be in
        /// `priorState` and the live scene must still match the prior — a
        /// state change that cannot be conflict-checked is refused, not
        /// trusted. For adds (<paramref name="go"/> null at check time,
        /// resolved by the caller at apply time) the prior checks are skipped:
        /// a new object has nothing to conflict with.
        /// </summary>
        private string CheckState(GameObject go, string prefabPath, StateJson state, HashSet<string> keys,
                                  bool parentIsNull, StateJson prior, HashSet<string> priorKeys,
                                  out System.Action<GameObject> apply, out bool conflict)
        {
            apply = null; conflict = false;
            if (keys == null || keys.Count == 0) return null;
            var steps = new List<System.Action<GameObject>>();
            bool checkPrior = go != null;   // modified entry: go resolved; add: skip priors

            if (checkPrior)
                foreach (var k in keys)
                    if (priorKeys == null || !priorKeys.Contains(k))
                        return "state." + k + " has no priorState." + k + " — an unverifiable change is refused, not trusted.";

            if (keys.Contains("active"))
            {
                if (checkPrior && go.activeSelf != prior.active)
                { conflict = true; return "CONFLICT — active is " + go.activeSelf + " in Unity, session expected " + prior.active + "."; }
                bool v = state.active;
                steps.Add(g => { Undo.RecordObject(g, "Import placement"); g.SetActive(v); });
            }

            if (keys.Contains("layer"))
            {
                // Names, never indices: indices are project-local, and a stale
                // index lands on the WRONG layer silently where an unknown
                // name refuses loudly.
                int idx = LayerMask.NameToLayer(state.layer ?? "");
                if (idx < 0) return "layer '" + state.layer + "' does not exist in this project.";
                if (checkPrior && LayerMask.LayerToName(go.layer) != prior.layer)
                { conflict = true; return "CONFLICT — layer is '" + LayerMask.LayerToName(go.layer) + "' in Unity, session expected '" + prior.layer + "'."; }
                // Root only, matching what the exporter reads. Children keep
                // whatever the prefab authored.
                steps.Add(g => { Undo.RecordObject(g, "Import placement"); g.layer = idx; });
            }

            if (keys.Contains("tag"))
            {
                if (!UnityEditorInternal.InternalEditorUtility.tags.Contains(state.tag))
                    return "tag '" + state.tag + "' is not defined in this project.";
                if (checkPrior && go.tag != prior.tag)
                { conflict = true; return "CONFLICT — tag is '" + go.tag + "' in Unity, session expected '" + prior.tag + "'."; }
                string v = state.tag;
                steps.Add(g => { Undo.RecordObject(g, "Import placement"); g.tag = v; });
            }

            if (keys.Contains("staticFlags"))
            {
                if (!TryParseFlags(state.staticFlags, out var flags, out string bad))
                    return "staticFlags contains '" + bad + "', which this Unity version does not define.";
                if (checkPrior)
                {
                    if (!TryParseFlags(prior.staticFlags, out var priorFlags, out string badPrior))
                        return "priorState.staticFlags contains '" + badPrior + "', which this Unity version does not define.";
                    if (GameObjectUtility.GetStaticEditorFlags(go) != priorFlags)
                    { conflict = true; return "CONFLICT — static flags changed in Unity after the export."; }
                }
                steps.Add(g => { Undo.RecordObject(g, "Import placement"); GameObjectUtility.SetStaticEditorFlags(g, flags); });
            }

            if (keys.Contains("materialVariant"))
            {
                var sets = HoloCityVariantSet.ByPrefabPath();
                sets.TryGetValue(prefabPath ?? "", out var set);
                if (checkPrior)
                {
                    string live = set == null ? null : set.CurrentKey(go);
                    if (live != prior.materialVariant)
                    { conflict = true; return "CONFLICT — material variant is '" + (live ?? "<default>") + "' in Unity, session expected '" + (prior.materialVariant ?? "<default>") + "'."; }
                }
                string key = state.materialVariant;
                if (key == null)
                {
                    // null = back to the prefab's own materials, read from the
                    // prefab asset itself so this cannot invent a material.
                    var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath ?? "");
                    if (prefab == null) return "materialVariant: null needs the prefab at '" + prefabPath + "', which is missing.";
                    var defaults = HoloCityVariantSet.FlattenSlots(prefab)
                        .Select(s => s.renderer.sharedMaterials[s.slot]).ToArray();
                    steps.Add(g =>
                    {
                        var slots = HoloCityVariantSet.FlattenSlots(g);
                        if (slots.Count != defaults.Length) { Debug.LogError("[PlacementImport] " + g.name + ": slot count changed; variant reset skipped."); return; }
                        foreach (var grp in slots.Select((s, i) => (s.renderer, s.slot, i)).GroupBy(x => x.renderer))
                        {
                            var mats = grp.Key.sharedMaterials;
                            foreach (var x in grp) mats[x.slot] = defaults[x.i];
                            Undo.RecordObject(grp.Key, "Import placement");
                            grp.Key.sharedMaterials = mats;
                        }
                    });
                }
                else
                {
                    if (set == null) return "no HoloCityVariantSet exists for '" + prefabPath + "' — variant keys are refused unless a human declared them.";
                    if (set.Find(key) == null) return "variant '" + key + "' is not declared for '" + prefabPath + "'.";
                    steps.Add(g =>
                    {
                        string err = set.Apply(g, key);
                        if (err != null) Debug.LogError("[PlacementImport] " + g.name + ": " + err);
                    });
                }
            }

            if (keys.Contains("parentId"))
            {
                Transform newParent = null;
                if (!parentIsNull)
                {
                    var p = Resolve(state.parentId);
                    if (p == null) return "parentId does not resolve in this scene.";
                    if (go != null && p.transform.IsChildOf(go.transform))
                        return "reparent refused — '" + p.name + "' is inside the object's own subtree (cycle).";
                    var top = p.transform.root;
                    if (top != null && top.name == TrashRootName)
                        return "reparent refused — target parent is in " + TrashRootName + ".";
                    newParent = p.transform;
                }
                if (checkPrior && prior.parentId != null)
                {
                    var pp = Resolve(prior.parentId);
                    if (pp == null || !go.transform.IsChildOf(pp.transform))
                    { conflict = true; return "CONFLICT — the object was reparented in Unity after the export."; }
                }
                steps.Add(g => Undo.SetTransformParent(g.transform, newParent, true, "Import placement"));
            }

            apply = g => { foreach (var s in steps) s(g); };
            return null;
        }

        private static bool TryParseFlags(string[] names, out StaticEditorFlags flags, out string bad)
        {
            flags = 0; bad = null;
            foreach (var n in names ?? new string[0])
            {
                if (!System.Enum.TryParse<StaticEditorFlags>(n, out var f)) { bad = n; return false; }
                flags |= f;
            }
            return true;
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

        /// <summary>
        /// Convert a world-space scale from the contract into the localScale
        /// that produces it under this transform's current parent.
        ///
        /// Exact for the axis-aligned case, which is what kit placement is. A
        /// non-uniformly scaled AND rotated parent cannot be represented by a
        /// localScale at all — Unity's own lossyScale is an approximation
        /// there too — so this reproduces Unity's own convention rather than
        /// inventing a better one. The Sanity() bounds catch the pathological
        /// results if one ever arises.
        /// </summary>
        private static Vector3 WorldToLocalScale(Transform t, Vector3 world)
        {
            var parent = t.parent;
            if (parent == null) return world;
            var ps = parent.lossyScale;
            return new Vector3(
                Mathf.Approximately(ps.x, 0f) ? world.x : world.x / ps.x,
                Mathf.Approximately(ps.y, 0f) ? world.y : world.y / ps.y,
                Mathf.Approximately(ps.z, 0f) ? world.z : world.z / ps.z);
        }

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

            if (!string.IsNullOrEmpty(_staleBanner))
                EditorGUILayout.HelpBox(_staleBanner, MessageType.Warning);

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

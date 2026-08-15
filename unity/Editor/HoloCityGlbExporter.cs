using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Holobots.EditorTools.Placement
{
    /// <summary>
    /// Exports one GLB per prefab, ASYNCHRONOUSLY, pumped from
    /// <see cref="EditorApplication.update"/>.
    ///
    /// WHY IT IS SHAPED THIS WAY — this is the second implementation. The first
    /// blocked the main thread on glTFast's Task via GetAwaiter().GetResult(),
    /// and that Task needs the main thread to progress: it deadlocked and froze
    /// the editor twice on 2026-08-02, both times needing a force-quit. Passing
    /// an UninterruptedDeferAgent did NOT help, because the blocking wait was
    /// the defect, not the agent.
    ///
    /// So there is NO WAIT ANYWHERE IN THIS FILE. Each export is started, the
    /// Task is stored, and completion is POLLED on the editor tick. The main
    /// thread stays free the whole time, which is precisely what the export
    /// needs in order to finish. If you are tempted to "simplify" this into a
    /// synchronous loop, that is the bug — it has already cost two sessions.
    ///
    /// One prefab is in flight at a time: exports are main-thread-bound anyway,
    /// so parallelism buys nothing and makes failure attribution ambiguous.
    /// </summary>
    public static class HoloCityGlbExporter
    {
        private static Queue<string> _queue;
        private static string _glbDir;
        private static Action<int, List<string>> _onDone;
        private static List<string> _failed;
        private static int _written, _total, _reused;

        // ------------------------------------------------------------ manifest

        /// <summary>
        /// Bump when anything about the emitted GLB changes — settings, the
        /// identity-transform rule, the glTFast major. It is mixed into every
        /// content hash, so bumping it invalidates the whole cache in one move.
        /// </summary>
        private const string ExporterVersion = "glb-1";

        public const string ManifestName = "manifest.json";

        [Serializable] private sealed class ManifestEntry { public string prefabPath, glb, hash; }
        [Serializable] private sealed class Manifest
        {
            public string schemaVersion = "1.0.0";
            public string kind = "holocity.glb-manifest";
            public string exporterVersion = ExporterVersion;
            public ManifestEntry[] entries;
        }

        private static Dictionary<string, string> _priorHashes;   // prefabPath -> hash
        private static Dictionary<string, string> _newHashes;

        /// <summary>
        /// Content hash for one prefab. <see cref="AssetDatabase.GetAssetDependencyHash"/>
        /// already covers the asset, its importer settings, AND its dependency
        /// graph — so a retextured material or a reimported FBX changes it
        /// without us enumerating what to look at. Enumerating by hand is how
        /// a cache goes stale in exactly the case nobody thought of.
        /// </summary>
        private static string ContentHash(string prefabPath)
            => ExporterVersion + ":" + AssetDatabase.GetAssetDependencyHash(prefabPath);

        private static void LoadManifest()
        {
            _priorHashes = new Dictionary<string, string>();
            _newHashes = new Dictionary<string, string>();
            string p = System.IO.Path.Combine(_glbDir, ManifestName);
            if (!System.IO.File.Exists(p)) return;
            try
            {
                var m = JsonUtility.FromJson<Manifest>(System.IO.File.ReadAllText(p));
                // A manifest from a different exporter version describes GLBs
                // this build would not produce. Ignore it wholesale rather than
                // trusting entry-by-entry.
                if (m == null || m.exporterVersion != ExporterVersion || m.entries == null) return;
                foreach (var e in m.entries)
                    if (!string.IsNullOrEmpty(e?.prefabPath)) _priorHashes[e.prefabPath] = e.hash;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[GlbExport] manifest unreadable, rebuilding everything: " + ex.Message);
                _priorHashes.Clear();
            }
        }

        private static void WriteManifest()
        {
            var entries = _newHashes
                .OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => new ManifestEntry
                {
                    prefabPath = kv.Key,
                    glb = System.IO.Path.GetFileName(GlbPathFor(kv.Key)),
                    hash = kv.Value,
                })
                .ToArray();
            var m = new Manifest { entries = entries };
            System.IO.File.WriteAllText(System.IO.Path.Combine(_glbDir, ManifestName),
                                        JsonUtility.ToJson(m, true) + "\n");
        }

        private static string GlbPathFor(string prefabPath)
        {
            string name = System.IO.Path.GetFileNameWithoutExtension(prefabPath);
            return System.IO.Path.Combine(_glbDir, name + ".glb");
        }

        /// <summary>
        /// A cached GLB counts only if the hash matches AND the file is really
        /// there with bytes in it. A manifest entry pointing at a missing or
        /// truncated file is the failure this check exists for — it is what a
        /// half-finished previous run leaves behind.
        /// </summary>
        private static bool CanReuse(string prefabPath)
        {
            if (!_priorHashes.TryGetValue(prefabPath, out string prior)) return false;
            if (prior != ContentHash(prefabPath)) return false;
            string out_ = GlbPathFor(prefabPath);
            return System.IO.File.Exists(out_) && new System.IO.FileInfo(out_).Length > 0;
        }

        private static System.Threading.Tasks.Task<bool> _task;
        private static GameObject _temp;
        private static string _currentPath, _currentOut;
        private static double _startedAt;

        /// <summary>Guard against a prefab that never completes wedging the tick forever.</summary>
        private const double PerPrefabTimeoutSeconds = 30.0;

        public static bool IsRunning => _queue != null;

        /// <summary>Found across ALL loaded assemblies — it is NOT in glTFast.Export.</summary>
        private static Type DeferAgentType =>
            AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => { try { return a.GetType("GLTFast.UninterruptedDeferAgent"); } catch { return null; } })
                .FirstOrDefault(t => t != null);

        private static Type ExportType =>
            AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => { try { return a.GetType("GLTFast.Export.GameObjectExport"); } catch { return null; } })
                .FirstOrDefault(t => t != null);

        public static void Run(IEnumerable<string> prefabPaths, string glbDir,
                               Action<int, List<string>> onDone)
        {
            if (IsRunning) { Debug.LogWarning("[GlbExport] already running."); return; }

            _glbDir = glbDir;
            _onDone = onDone;
            _failed = new List<string>();
            _written = 0;
            _reused = 0;
            System.IO.Directory.CreateDirectory(_glbDir);

            // INCREMENTAL. Re-exporting every GLB on every run is minutes of
            // editor time for a whole town, and a pipeline that costs minutes
            // per iteration stops being used. Skip the prefabs whose content
            // hash is unchanged and whose GLB is still on disk.
            //
            // To force a full rebuild, delete glb/manifest.json.
            LoadManifest();

            var ordered = prefabPaths.Distinct().OrderBy(x => x, StringComparer.Ordinal).ToList();
            var todo = new List<string>();
            foreach (var p in ordered)
            {
                if (CanReuse(p)) { _reused++; _newHashes[p] = _priorHashes[p]; }
                else todo.Add(p);
            }

            _queue = new Queue<string>(todo);
            _total = _queue.Count;

            if (_total == 0)
            {
                Debug.Log($"[GlbExport] nothing to do — all {_reused} GLB(s) up to date in {_glbDir}");
                WriteManifest();
                var none = _failed; _failed = null; _queue = null;
                onDone?.Invoke(_reused, none);
                return;
            }

            if (ExportType == null) { Fail("glTFast not loaded — no GLBs written."); return; }
            // Refuse rather than proceed with a null agent: a null agent restores
            // the yielding behaviour and is how the deadlock came back the second time.
            if (DeferAgentType == null) { Fail("UninterruptedDeferAgent not found — refusing to export."); return; }

            Debug.Log($"[GlbExport] starting: {_total} prefab(s) to export, "
                      + $"{_reused} reused from manifest -> {_glbDir}");
            EditorApplication.update += Tick;
        }

        private static void Fail(string why)
        {
            _failed.Add(why);
            Debug.LogError("[GlbExport] " + why);
            Finish();
        }

        private static void Tick()
        {
            try
            {
                if (_task == null)
                {
                    if (_queue.Count == 0) { Finish(); return; }
                    StartNext();
                    return;                      // let the export have this frame
                }

                if (!_task.IsCompleted)
                {
                    if (EditorApplication.timeSinceStartup - _startedAt > PerPrefabTimeoutSeconds)
                    {
                        _failed.Add(_currentPath + " (timed out after "
                                    + PerPrefabTimeoutSeconds + "s — skipped, not hung)");
                        CleanupCurrent();
                    }
                    return;                      // still working; DO NOT WAIT ON IT
                }

                bool ok = !_task.IsFaulted && _task.Result;
                if (ok && System.IO.File.Exists(_currentOut) && new System.IO.FileInfo(_currentOut).Length > 0)
                {
                    _written++;
                    // Record the hash ONLY on a verified successful write. A
                    // failed or timed-out prefab must stay absent from the
                    // manifest so the next run retries it — caching a failure
                    // as done is how a bundle ends up permanently missing a
                    // mesh while every subsequent export reports success.
                    _newHashes[_currentPath] = ContentHash(_currentPath);
                }
                else
                    _failed.Add(_currentPath + (_task.IsFaulted
                        ? " (" + _task.Exception?.GetBaseException().Message + ")"
                        : " (glTFast reported failure or wrote 0 bytes)"));

                CleanupCurrent();

                if (_written > 0 && _written % 25 == 0)
                    Debug.Log($"[GlbExport] {_written}/{_total} written…");
            }
            catch (Exception ex)
            {
                _failed.Add((_currentPath ?? "<none>") + " (tick: " + ex.GetBaseException().Message + ")");
                CleanupCurrent();
            }
        }

        private static void StartNext()
        {
            _currentPath = _queue.Dequeue();
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(_currentPath);
            if (prefab == null) { _failed.Add(_currentPath + " (asset missing)"); return; }

            _currentOut = System.IO.Path.Combine(_glbDir, prefab.name + ".glb");

            // Identity transform: the manifest carries each instance's world
            // transform and the palette carries the prefab's own default
            // rotation, so baking either into the GLB would apply it twice.
            _temp = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            _temp.hideFlags = HideFlags.HideAndDontSave;
            _temp.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            _temp.transform.localScale = Vector3.one;

            var settingsType = ExportType.Assembly.GetType("GLTFast.Export.ExportSettings");
            var settings = Activator.CreateInstance(settingsType);
            var fmt = settingsType.GetProperty("Format");
            fmt.SetValue(settings, Enum.Parse(fmt.PropertyType, "Binary"));

            // Every ctor parameter is optional, which reflection cannot bind by
            // omission — all five must be passed explicitly.
            var export = Activator.CreateInstance(ExportType,
                new object[] { settings, null, null, Activator.CreateInstance(DeferAgentType), null });

            var addScene = ExportType.GetMethods()
                .First(m => m.Name == "AddScene" && m.GetParameters()[0].ParameterType == typeof(GameObject[]));
            addScene.Invoke(export, new object[] { new[] { _temp }, prefab.name });

            var save = ExportType.GetMethod("SaveToFileAndDispose");
            var args = new object[save.GetParameters().Length];
            args[0] = _currentOut;
            for (int i = 1; i < args.Length; i++)
            {
                var pt = save.GetParameters()[i].ParameterType;
                args[i] = pt.IsValueType ? Activator.CreateInstance(pt) : null;
            }

            // Start it and WALK AWAY. No await, no .Result, no GetAwaiter().
            _task = save.Invoke(export, args) as System.Threading.Tasks.Task<bool>;
            _startedAt = EditorApplication.timeSinceStartup;
        }

        private static void CleanupCurrent()
        {
            if (_temp != null) UnityEngine.Object.DestroyImmediate(_temp);
            _temp = null;
            _task = null;
            _currentPath = null;
            _currentOut = null;
        }

        private static void Finish()
        {
            EditorApplication.update -= Tick;
            CleanupCurrent();
            var done = _onDone;
            int written = _written, reused = _reused;
            var failed = _failed ?? new List<string>();

            // Written before the callback so the manifest is on disk even if a
            // consumer throws. A partial run still writes what it achieved —
            // the entries it recorded are exactly the verified successes, so
            // the next run picks up where this one stopped.
            try { if (_newHashes != null) WriteManifest(); }
            catch (Exception ex) { Debug.LogWarning("[GlbExport] manifest write failed: " + ex.Message); }

            _queue = null; _onDone = null; _failed = null;
            AssetDatabase.Refresh();
            Debug.Log($"[GlbExport] finished: {written} written, {reused} reused, {failed.Count} failed."
                      + (failed.Count > 0 ? "\n  FAILED:\n    " + string.Join("\n    ", failed) : "")
                      + "\n  (delete glb/" + ManifestName + " to force a full rebuild)");
            done?.Invoke(written + reused, failed);
        }
    }
}

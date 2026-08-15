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
        private static int _written, _total;

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

            _queue = new Queue<string>(prefabPaths.Distinct().OrderBy(x => x, StringComparer.Ordinal));
            _glbDir = glbDir;
            _onDone = onDone;
            _failed = new List<string>();
            _written = 0;
            _total = _queue.Count;
            System.IO.Directory.CreateDirectory(_glbDir);

            if (ExportType == null) { Fail("glTFast not loaded — no GLBs written."); return; }
            // Refuse rather than proceed with a null agent: a null agent restores
            // the yielding behaviour and is how the deadlock came back the second time.
            if (DeferAgentType == null) { Fail("UninterruptedDeferAgent not found — refusing to export."); return; }

            Debug.Log($"[GlbExport] starting: {_total} prefab(s) -> {_glbDir}");
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
                    _written++;
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
            int written = _written;
            var failed = _failed ?? new List<string>();
            _queue = null; _onDone = null; _failed = null;
            AssetDatabase.Refresh();
            Debug.Log($"[GlbExport] finished: {written} written, {failed.Count} failed."
                      + (failed.Count > 0 ? "\n  FAILED:\n    " + string.Join("\n    ", failed) : ""));
            done?.Invoke(written, failed);
        }
    }
}

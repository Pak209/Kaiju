using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Holobots.EditorTools.Placement
{
    /// <summary>
    /// The CLOSED SET of material swaps a prefab is allowed to have.
    ///
    /// WHY THIS EXISTS AS AN ASSET rather than a naming convention. The
    /// importer's central rule is that the web editor never names a project
    /// asset — it names a palette key, and Unity resolves it. Extend that to
    /// materials and something has to define what a "variant" is. Inferring it
    /// from sibling materials or a filename prefix would be a guess, and a
    /// guess here silently applies the wrong material to a building. So it is
    /// declared, by a human, in an asset.
    ///
    /// An empty project simply has no variant sets, and every palette item
    /// ships `materialVariants: []`. The feature is inert until someone
    /// authors one; nothing else changes.
    ///
    /// Create: Assets ▸ Create ▸ Holobots ▸ HoloCity ▸ Material Variant Set
    /// </summary>
    [CreateAssetMenu(menuName = "Holobots/HoloCity/Material Variant Set", fileName = "HC_Variants")]
    public sealed class HoloCityVariantSet : ScriptableObject
    {
        [Tooltip("The prefab these variants apply to.")]
        public GameObject prefab;

        [System.Serializable]
        public sealed class Variant
        {
            [Tooltip("Stable id. This is what crosses the boundary — renaming it breaks existing diffs.")]
            public string key;
            public string displayName;
            [Tooltip("Optional colour the web editor can show without loading the material.")]
            public Color swatch = Color.white;

            [Tooltip("One material per renderer slot, in the order FlattenSlots walks them. "
                   + "A count mismatch is refused rather than partially applied.")]
            public Material[] materials;
        }

        public Variant[] variants;

        // ------------------------------------------------------------ lookup

        /// <summary>All sets in the project, keyed by prefab path. Editor-only, rebuilt per call.</summary>
        public static Dictionary<string, HoloCityVariantSet> ByPrefabPath()
        {
            var map = new Dictionary<string, HoloCityVariantSet>();
            foreach (var guid in AssetDatabase.FindAssets("t:" + nameof(HoloCityVariantSet)))
            {
                var set = AssetDatabase.LoadAssetAtPath<HoloCityVariantSet>(AssetDatabase.GUIDToAssetPath(guid));
                if (set == null || set.prefab == null) continue;
                string p = AssetDatabase.GetAssetPath(set.prefab);
                if (!string.IsNullOrEmpty(p)) map[p] = set;
            }
            return map;
        }

        public Variant Find(string key) =>
            variants?.FirstOrDefault(v => v != null && v.key == key);

        // ------------------------------------------------------------- slots

        /// <summary>
        /// Every material slot on the instance, in a DETERMINISTIC order.
        ///
        /// GetComponentsInChildren is depth-first and stable for a given
        /// hierarchy, but the order is the contract here — the variant's
        /// materials array is positional — so it is named in one place rather
        /// than assumed at each call site.
        /// </summary>
        public static List<(Renderer renderer, int slot)> FlattenSlots(GameObject instance)
        {
            var slots = new List<(Renderer, int)>();
            foreach (var r in instance.GetComponentsInChildren<Renderer>(true))
                for (int i = 0; i < r.sharedMaterials.Length; i++)
                    slots.Add((r, i));
            return slots;
        }

        /// <summary>
        /// Which variant is currently on this instance, or null for none.
        ///
        /// Compared by MATERIAL IDENTITY per slot, not by slot count. Two
        /// variants with the same slot count are the normal case, so counting
        /// would happily report the wrong one.
        /// </summary>
        public string CurrentKey(GameObject instance)
        {
            if (variants == null) return null;
            var live = FlattenSlots(instance).Select(s => s.renderer.sharedMaterials[s.slot]).ToList();
            foreach (var v in variants)
            {
                if (v?.materials == null || v.materials.Length != live.Count) continue;
                bool all = true;
                for (int i = 0; i < live.Count; i++)
                    if (v.materials[i] != live[i]) { all = false; break; }
                if (all) return v.key;
            }
            return null;
        }

        /// <summary>
        /// Apply a variant. Returns null on success, or the reason it was
        /// refused — never a partial application. Half a building retextured
        /// is harder to notice, and harder to undo, than none of it.
        /// </summary>
        public string Apply(GameObject instance, string key)
        {
            var v = Find(key);
            if (v == null) return "variant '" + key + "' is not declared for this prefab.";
            if (v.materials == null) return "variant '" + key + "' declares no materials.";

            var slots = FlattenSlots(instance);
            if (slots.Count != v.materials.Length)
                return "variant '" + key + "' has " + v.materials.Length + " material(s) but the instance has "
                     + slots.Count + " slot(s) — the prefab changed since the variant was authored.";
            for (int i = 0; i < v.materials.Length; i++)
                if (v.materials[i] == null) return "variant '" + key + "' slot " + i + " is empty.";

            // Group by renderer: sharedMaterials returns a copy, so assigning
            // element-wise to the property does nothing at all.
            foreach (var g in slots.Select((s, i) => (s.renderer, s.slot, i)).GroupBy(x => x.renderer))
            {
                var mats = g.Key.sharedMaterials;
                foreach (var x in g) mats[x.slot] = v.materials[x.i];
                Undo.RecordObject(g.Key, "Import placement");
                g.Key.sharedMaterials = mats;
            }
            return null;
        }
    }
}

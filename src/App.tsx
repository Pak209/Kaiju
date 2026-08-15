import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Grid3X3,
  ImagePlus,
  LockKeyhole,
  MousePointer2,
  Move3D,
  Redo2,
  RotateCw,
  Save,
  Scale3D,
  Search,
  Trash2,
  Undo2,
  UsersRound,
  View,
} from "lucide-react";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import Viewport from "./Viewport";
import {
  addItem,
  buildDiff,
  cloneTransform,
  createSession,
  exportJson,
} from "./core";
import type {
  EditableItem,
  Palette,
  SceneExport,
  Session,
  Transform,
} from "./types";
import sceneSchema from "../bridge/schema/scene_export.schema.json";
import paletteSchema from "../bridge/schema/palette.schema.json";
import { groupForEntry, sceneGroups, type SceneGroup } from "./sceneGroups";
import { applySkyboxMacroLayout } from "./skyboxLayout";
type Mode = "translate" | "rotate" | "scale";
const Btn = ({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    title={title}
    disabled={disabled}
    className={active ? "active" : ""}
    onClick={onClick}
  >
    {children}
  </button>
);
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [files, setFiles] = useState(new Map<string, File>()),
    [selection, setSelection] = useState<string[]>([]),
    [mode, setMode] = useState<Mode>("translate"),
    [snap, setSnap] = useState(true),
    [frameRequest, setFrameRequest] = useState<{
      sequence: number;
      target: "all" | "selection" | "hero" | "top";
    }>({ sequence: 0, target: "all" }),
    [compositionGuides, setCompositionGuides] = useState(false),
    [referenceUrl, setReferenceUrl] = useState<string | null>(null),
    [referenceVisible, setReferenceVisible] = useState(true),
    [referenceOpacity, setReferenceOpacity] = useState(0.28),
    [hiddenGroups, setHiddenGroups] = useState<Set<SceneGroup>>(new Set()),
    [query, setQuery] = useState(""),
    [assetStats, setAssetStats] = useState({
      loaded: 0,
      failed: 0,
      total: 0,
      available: 0,
    }),
    [notice, setNotice] = useState("Open an export bundle to begin");
  const input = useRef<HTMLInputElement>(null),
    restore = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    history = useRef<EditableItem[][]>([]),
    future = useRef<EditableItem[][]>([]),
    counter = useRef(1);
  const mutate = (fn: (x: EditableItem[]) => EditableItem[]) =>
    setSession((s) => {
      if (!s) return s;
      history.current.push(structuredClone(s.editable));
      future.current = [];
      return { ...s, editable: fn(structuredClone(s.editable)) };
    });
  const undo = () =>
    setSession((s) => {
      const x = history.current.pop();
      if (!s || !x) return s;
      future.current.push(structuredClone(s.editable));
      return { ...s, editable: x };
    });
  const redo = () =>
    setSession((s) => {
      const x = future.current.pop();
      if (!s || !x) return s;
      history.current.push(structuredClone(s.editable));
      return { ...s, editable: x };
    });
  const normalizePath = (path: string) =>
    path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
  const loadBundle = async (unscopedMap: Map<string, File>) => {
    try {
      setNotice("Reading bundle manifest…");
      const manifests = [...unscopedMap.keys()].filter(
        (path) =>
          path === "scene_export.json" || path.endsWith("/scene_export.json"),
      );
      const manifestPath = manifests.find((path) => {
        const slash = path.lastIndexOf("/");
        const prefix = slash >= 0 ? path.slice(0, slash + 1) : "";
        return unscopedMap.has(`${prefix}palette.json`);
      });
      if (!manifestPath) {
        throw new Error(
          "No export bundle found. Choose a folder containing scene_export.json and palette.json.",
        );
      }
      const slash = manifestPath.lastIndexOf("/");
      const prefix = slash >= 0 ? manifestPath.slice(0, slash + 1) : "";
      const map = new Map<string, File>();
      for (const [path, file] of unscopedMap) {
        if (!path.startsWith(prefix)) continue;
        map.set(path.slice(prefix.length), file);
      }
      const scene = JSON.parse(
          await map.get("scene_export.json")!.text(),
        ) as SceneExport,
        palette = JSON.parse(await map.get("palette.json")!.text()) as Palette;
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      if (
        !ajv.validate(sceneSchema, scene) ||
        !ajv.validate(paletteSchema, palette)
      )
        throw new Error(ajv.errorsText());
      setFiles(map);
      setSession(createSession(scene, palette));
      setAssetStats({ loaded: 0, failed: 0, total: 0, available: 0 });
      setSelection([]);
      setHiddenGroups(new Set());
      history.current = [];
      future.current = [];
      const linkedEntries = scene.entries.filter((entry) => entry.glb).length;
      setNotice(
        linkedEntries
          ? `${scene.sceneName} loaded`
          : `${scene.sceneName} loaded · resolving legacy GLB filenames`,
      );
    } catch (e) {
      setNotice(
        `Bundle rejected: ${e instanceof Error ? e.message : "invalid files"}`,
      );
    }
  };
  const openFiles = async (list: FileList | null) => {
    if (!list) return;
    setNotice("Indexing selected folder…");
    const map = new Map<string, File>();
    for (const f of Array.from(list)) {
      const rel =
        (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
        f.name;
      const parts = normalizePath(rel).split("/");
      map.set(parts.length > 1 ? parts.slice(1).join("/") : parts[0], f);
    }
    await loadBundle(map);
  };
  const openBundle = () => {
    setNotice("Waiting for folder selection…");
    input.current?.click();
  };
  const save = () => session && exportJson("holocity-session.json", session);
  const loadSession = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    try {
      const s = JSON.parse(await f.text()) as Session;
      setSession(s);
      setNotice(
        "Working session restored — reopen its bundle to restore mesh files",
      );
    } catch {
      setNotice("Session file is invalid");
    }
  };
  const exportDiff = () => {
    if (!session) return;
    exportJson("placement_diff.json", buildDiff(session));
    setNotice("placement_diff.json exported");
  };
  const commit = (id: string, t: Transform) =>
    mutate((items) =>
      items.map((x) => (x.id === id ? { ...x, transform: t } : x)),
    );
  const commitMany = (changes: { id: string; transform: Transform }[]) => {
    const byId = new Map(changes.map((change) => [change.id, change.transform]));
    mutate((items) =>
      items.map((item) => {
        const transform = byId.get(item.id);
        return transform ? { ...item, transform } : item;
      }),
    );
  };
  const selected = selection.at(-1) ?? null;
  const select = (id: string | null, additive = false) => {
    if (!id) {
      if (!additive) setSelection([]);
      return;
    }
    setSelection((current) => {
      if (!additive) return [id];
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  };
  const remove = () => {
    if (!selection.length) return;
    const ids = new Set(selection);
    mutate((items) =>
      items.map((x) => (ids.has(x.id) ? { ...x, deleted: true } : x)),
    );
    setSelection([]);
  };
  const duplicate = () => {
    if (!session || !selection.length) return;
    const ids = new Set(selection);
    const sources = session.editable.filter((item) => ids.has(item.id));
    const copies = sources.map((src) => {
      const id = `add-${String(counter.current++).padStart(3, "0")}`;
      return {
        ...structuredClone(src),
        id,
        name: `${src.name} copy`,
        isAdded: true,
        priorTransform: undefined,
        deleted: false,
        transform: {
          ...cloneTransform(src.transform),
          position: [
            src.transform.position[0] + 1,
            src.transform.position[1],
            src.transform.position[2] + 1,
          ] as [number, number, number],
        },
      } satisfies EditableItem;
    });
    mutate((items) => [...items, ...copies]);
    setSelection(copies.map((copy) => copy.id));
  };
  const place = (i: Palette["items"][number]) => {
    if (!session) return;
    const item = addItem(session, i, counter.current++);
    mutate((x) => [...x, item]);
    setSelection([item.id]);
    setNotice(`${i.displayName} placed at origin; move it in the viewport`);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate();
      } else if (e.key === "Delete" || e.key === "Backspace") remove();
      else if (e.key.toLowerCase() === "w") setMode("translate");
      else if (e.key.toLowerCase() === "e") setMode("rotate");
      else if (e.key.toLowerCase() === "r") setMode("scale");
      else if (e.key.toLowerCase() === "f" && selection.length) {
        e.preventDefault();
        setFrameRequest((request) => ({
          sequence: request.sequence + 1,
          target: "selection",
        }));
      } else if (e.key === "Home") {
        e.preventDefault();
        setFrameRequest((request) => ({
          sequence: request.sequence + 1,
          target: "all",
        }));
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  useEffect(
    () => () => {
      if (referenceUrl) URL.revokeObjectURL(referenceUrl);
    },
    [referenceUrl],
  );
  const sceneEntriesById = useMemo(
    () =>
      new Map(session?.scene.entries.map((entry) => [entry.id, entry]) ?? []),
    [session],
  );
  const picked = session?.editable.find((x) => x.id === selected),
    pickedEntry = selected ? sceneEntriesById.get(selected) : undefined,
    locked = session?.scene.entries.filter((x) => !x.editable).length ?? 0,
    visible = session?.editable.filter((x) => !x.deleted).length ?? 0;
  const palette = useMemo(
    () =>
      session?.palette.items.filter((x) =>
        x.displayName.toLowerCase().includes(query.toLowerCase()),
      ) ?? [],
    [session, query],
  );
  const setAxis = (kind: keyof Transform, index: number, value: number) => {
    if (!picked || !Number.isFinite(value)) return;
    const t = cloneTransform(picked.transform);
    t[kind][index] = value;
    commit(picked.id, t);
  };
  const groupCounts = useMemo(() => {
    const counts = new Map<SceneGroup, number>(
      sceneGroups.map((group) => [group, 0]),
    );
    if (!session) return counts;
    for (const entry of session.scene.entries) {
      const group = groupForEntry(entry, session.viewGroups);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return counts;
  }, [session]);
  const toggleGroup = (group: SceneGroup) =>
    setHiddenGroups((hidden) => {
      const next = new Set(hidden);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const selectGroup = (group: SceneGroup) => {
    if (!session) return;
    const ids = session.editable
      .filter((item) => {
        if (item.deleted) return false;
        const entry = sceneEntriesById.get(item.id);
        return entry && groupForEntry(entry, session.viewGroups) === group;
      })
      .map((item) => item.id);
    setHiddenGroups((hidden) => {
      const next = new Set(hidden);
      next.delete(group);
      return next;
    });
    setSelection(ids);
    setNotice(`${ids.length} ${group.toLowerCase()} objects selected`);
  };
  const assignGroup = (group: SceneGroup) => {
    if (!session || !selection.length) return;
    const ids = new Set(selection);
    const assignments = Object.fromEntries(
      selection.map((id) => [id, group]),
    );
    setSession({
      ...session,
      viewGroups: { ...session.viewGroups, ...assignments },
    });
    setNotice(
      `${ids.size} object${ids.size === 1 ? "" : "s"} assigned to ${group}`,
    );
  };
  const requestCamera = (target: "hero" | "top" | "all") =>
    setFrameRequest((request) => ({
      sequence: request.sequence + 1,
      target,
    }));
  const applyMacroLayout = () => {
    if (!session) return;
    const result = applySkyboxMacroLayout(
      structuredClone(session.editable),
      session.scene.entries,
    );
    if (!result.changed) {
      setNotice("No recognized HoloCity landmarks were found in this bundle");
      return;
    }
    mutate(() => result.editable);
    setSelection([]);
    setCompositionGuides(true);
    requestCamera("hero");
    setNotice(
      `Skybox macro pass moved ${result.changed} editable landmarks · Undo restores the previous layout`,
    );
  };
  const loadReference = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setReferenceUrl(URL.createObjectURL(file));
    setReferenceVisible(true);
    setNotice("Reference image loaded locally");
  };
  return (
    <main>
      <header>
        <div className="brand">
          <Box />
          HoloCity Placer
        </div>
        <Btn title="Open export bundle" onClick={openBundle}>
          <FolderOpen />
          Open Bundle
        </Btn>
        <Btn title="Save working session" onClick={save} disabled={!session}>
          <Save />
          Save Session
        </Btn>
        <div className="modes">
          <Btn
            title="Move (W)"
            active={mode === "translate"}
            onClick={() => setMode("translate")}
          >
            <Move3D />
            Move
          </Btn>
          <Btn
            title="Rotate (E)"
            active={mode === "rotate"}
            onClick={() => setMode("rotate")}
          >
            <RotateCw />
            Rotate
          </Btn>
          <Btn
            title="Scale (R)"
            active={mode === "scale"}
            onClick={() => setMode("scale")}
          >
            <Scale3D />
            Scale
          </Btn>
        </div>
        <Btn
          title="Toggle snapping"
          active={snap}
          onClick={() => setSnap((x) => !x)}
        >
          <Grid3X3 />
          Snap
        </Btn>
        <Btn title="Undo" onClick={undo} disabled={!history.current.length}>
          <Undo2 />
          Undo
        </Btn>
        <Btn title="Redo" onClick={redo} disabled={!future.current.length}>
          <Redo2 />
          Redo
        </Btn>
        <Btn
          title="Export placement diff"
          onClick={exportDiff}
          disabled={!session}
        >
          <Download />
          Export Diff
        </Btn>
        <input
          ref={input}
          type="file"
          multiple // @ts-expect-error directory picker
          webkitdirectory=""
          onChange={(e) => {
            void openFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={restore}
          type="file"
          accept="application/json"
          onChange={(e) => loadSession(e.target.files)}
        />
        <input
          ref={referenceInput}
          type="file"
          accept="image/*"
          onChange={(e) => {
            loadReference(e.target.files);
            e.target.value = "";
          }}
        />
      </header>
      <section className="workspace">
        <aside className="palette">
          <h2>Asset Palette</h2>
          <label className="search">
            <Search />
            <input
              placeholder="Search assets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!session && (
            <div className="empty">
              <FolderOpen />
              <strong>No bundle open</strong>
              <span>
                Select an export bundle folder containing scene_export.json and
                palette.json.
              </span>
              <button onClick={openBundle}>Choose folder</button>
              <button
                className="subtle"
                onClick={() => restore.current?.click()}
              >
                Restore session
              </button>
            </div>
          )}
          {palette.map((x) => (
            <button
              className="asset"
              key={x.prefabPath}
              onClick={() => place(x)}
            >
              {x.thumbnail && files.get(x.thumbnail) ? (
                <img src={URL.createObjectURL(files.get(x.thumbnail)!)} />
              ) : (
                <Box />
              )}
              <span>
                <strong>{x.displayName}</strong>
                <small>{x.kitFamily}</small>
              </span>
              <b>+</b>
            </button>
          ))}
        </aside>
        <div className="canvas">
          {session ? (
            <Viewport
              scene={session.scene}
              editable={session.editable}
              files={files}
              mode={mode}
              snap={snap}
              frameRequest={frameRequest}
              compositionGuides={compositionGuides}
              hiddenGroups={hiddenGroups}
              groupOverrides={session.viewGroups ?? {}}
              onAssetStats={setAssetStats}
              selected={selection}
              onSelect={select}
              onCommitMany={commitMany}
            />
          ) : (
            <div className="blank">
              <MousePointer2 />
              <h1>Place the town, visually.</h1>
              <p>
                Open a Unity export bundle. Everything stays on this device.
              </p>
            </div>
          )}
          {session && referenceUrl && referenceVisible && (
            <img
              className="reference-overlay"
              src={referenceUrl}
              style={{ opacity: referenceOpacity }}
              alt="Skybox composition reference"
            />
          )}
        </div>
        <aside className="inspector">
          <h2>Scene</h2>
          {session && (
            <>
              <div className="scene-title">
                <Box />
                <span>
                  <strong>{session.scene.sceneName}</strong>
                  <small>
                    {session.scene.exportMode === "whole"
                      ? "Whole town"
                      : (session.scene.districtName ?? "District")}
                  </small>
                </span>
              </div>
              <h2>Skybox Match</h2>
              <div className="composition-panel">
                <div className="composition-actions">
                  <button onClick={() => requestCamera("hero")}>
                    <View />
                    Hero view
                  </button>
                  <button onClick={() => requestCamera("top")}>
                    <Grid3X3 />
                    Top view
                  </button>
                </div>
                <label className="composition-toggle">
                  <input
                    type="checkbox"
                    checked={compositionGuides}
                    onChange={(event) =>
                      setCompositionGuides(event.target.checked)
                    }
                  />
                  Show 25 / 70 / 110 m composition rings
                </label>
                <div className="reference-controls">
                  <button onClick={() => referenceInput.current?.click()}>
                    <ImagePlus />
                    {referenceUrl ? "Replace reference" : "Load reference"}
                  </button>
                  {referenceUrl && (
                    <button
                      onClick={() => setReferenceVisible((visible) => !visible)}
                    >
                      {referenceVisible ? <EyeOff /> : <Eye />}
                      {referenceVisible ? "Hide" : "Show"}
                    </button>
                  )}
                </div>
                {referenceUrl && (
                  <label className="opacity-control">
                    <span>Reference opacity</span>
                    <input
                      type="range"
                      min="0.08"
                      max="0.75"
                      step="0.01"
                      value={referenceOpacity}
                      onChange={(event) =>
                        setReferenceOpacity(event.target.valueAsNumber)
                      }
                    />
                  </label>
                )}
                <button className="macro-layout" onClick={applyMacroLayout}>
                  Apply first-pass macro layout
                </button>
                <small>
                  Moves recognized editable landmarks in one undo step. Docks,
                  terrain, water, vegetation and locked context stay unchanged.
                </small>
              </div>
              <div className="layer-panel">
                <div className="layer-actions">
                  <strong>Display layers</strong>
                  <button onClick={() => setHiddenGroups(new Set())}>
                    Show all
                  </button>
                  <button onClick={() => setHiddenGroups(new Set(sceneGroups))}>
                    Hide all
                  </button>
                </div>
                {sceneGroups.map((group) => {
                  const hidden = hiddenGroups.has(group);
                  return (
                    <div
                      className={`layer-row${hidden ? " hidden" : ""}`}
                      key={group}
                    >
                      <button
                        className="layer-visibility"
                        onClick={() => toggleGroup(group)}
                        aria-pressed={!hidden}
                        title={`${hidden ? "Show" : "Hide"} ${group}`}
                      >
                        {hidden ? <EyeOff /> : <Eye />}
                        <span>{group}</span>
                        <b>
                          {hidden
                            ? `0 / ${groupCounts.get(group) ?? 0}`
                            : (groupCounts.get(group) ?? 0)}
                        </b>
                      </button>
                      <button
                        className="layer-select"
                        onClick={() => selectGroup(group)}
                        title={`Select all editable ${group.toLowerCase()}`}
                      >
                        <UsersRound />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="scene-list">
                {session.editable
                  .filter((x) => {
                    if (x.deleted) return false;
                    const entry = sceneEntriesById.get(x.id);
                    return (
                      !entry ||
                      !hiddenGroups.has(
                        groupForEntry(entry, session.viewGroups),
                      )
                    );
                  })
                  .map((x) => (
                    <button
                      className={selection.includes(x.id) ? "selected" : ""}
                      key={x.id}
                      onClick={(event) => select(x.id, event.shiftKey)}
                    >
                      <Box />
                      {x.name}
                    </button>
                  ))}
              </div>
              <h2>Selection</h2>
              {selection.length > 1 ? (
                <div className="selection-details multi-selection">
                  <strong>{selection.length} objects selected</strong>
                  <small>
                    Drag the gizmo to transform the selection together. Shift-click
                    the canvas or Scene rows to add or remove objects.
                  </small>
                  <label>
                    <span>Display group</span>
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value)
                          assignGroup(event.target.value as SceneGroup);
                        event.target.value = "";
                      }}
                    >
                      <option value="" disabled>
                        Assign group…
                      </option>
                      {sceneGroups.map((group) => (
                        <option key={group}>{group}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : picked && pickedEntry && !picked.deleted ? (
                <div className="selection-details">
                  <strong>{picked.name}</strong>
                  <small title={picked.prefabPath}>{picked.prefabPath}</small>
                  <label>
                    <span>Display group</span>
                    <select
                      value={groupForEntry(pickedEntry, session.viewGroups)}
                      onChange={(event) =>
                        assignGroup(event.target.value as SceneGroup)
                      }
                    >
                      {sceneGroups.map((group) => (
                        <option key={group}>{group}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                <div className="hint">
                  Click an editable object or its Scene row.
                </div>
              )}
              <h2>Transform</h2>
              {selection.length > 1 ? (
                <div className="transform multi-transform">
                  <p>
                    Use <kbd>W</kbd>, <kbd>E</kbd>, or <kbd>R</kbd> and drag the
                    gizmo. Relative spacing is preserved.
                  </p>
                  <div className="ops">
                    <button onClick={duplicate}>Duplicate all</button>
                    <button className="danger" onClick={remove}>
                      <Trash2 />
                      Delete all
                    </button>
                  </div>
                </div>
              ) : picked && !picked.deleted ? (
                <div className="transform">
                  {(["position", "rotation", "scale"] as const).map((kind) => (
                    <fieldset key={kind}>
                      <legend>{kind[0].toUpperCase() + kind.slice(1)}</legend>
                      <div>
                        {picked.transform[kind].slice(0, 3).map((v, i) => (
                          <label key={i}>
                            <span>{"XYZ"[i]}</span>
                            <input
                              type="number"
                              step="0.1"
                              value={Number(v.toFixed(3))}
                              onChange={(e) =>
                                setAxis(kind, i, e.target.valueAsNumber)
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <div className="ops">
                    <button onClick={duplicate}>Duplicate</button>
                    <button className="danger" onClick={remove}>
                      <Trash2 />
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="hint">
                  Select an editable object to inspect its Unity-space
                  transform.
                </div>
              )}
              <div className="gizmo-help">
                <strong>Using the transform gizmo</strong>
                <span>
                  <kbd>W</kbd> Move — drag an axis arrow or the square between
                  two axes.
                </span>
                <span>
                  <kbd>E</kbd> Rotate — drag a colored rotation ring.
                </span>
                <span>
                  <kbd>R</kbd> Scale — drag an axis handle or center handle.
                </span>
                <span>
                  Red = X · Green = Y · Blue = Z · <kbd>F</kbd> frame selection.
                </span>
              </div>
              <h2>Locked context</h2>
              <div className="locked">
                <LockKeyhole />
                <span>
                  <strong>{locked} objects protected</strong>
                  <small>
                    Visible and occluding, never selectable or exportable.
                  </small>
                </span>
              </div>
            </>
          )}
        </aside>
      </section>
      <footer>
        <span>{notice}</span>
        <span>
          {session?.scene.exportMode === "whole" ? "Whole town" : "District"}
        </span>
        <span>
          Editable <b>{visible}</b>
        </span>
        <span>
          Locked <b>{locked}</b>
        </span>
        <span className={assetStats.failed ? "asset-errors" : ""}>
          Scene GLBs:{" "}
          <b>
            {assetStats.loaded}/{assetStats.total}
          </b>
          {assetStats.failed > 0 && (
            <>
              {" "}
              · failed <b>{assetStats.failed}</b>
            </>
          )}
          {assetStats.available > 0 && <> · {assetStats.available} available</>}
        </span>
        <span>
          W Move&nbsp;&nbsp; E Rotate&nbsp;&nbsp; R Scale&nbsp;&nbsp; ⌘D
          Duplicate&nbsp;&nbsp; ⌫ Delete&nbsp;&nbsp; F Frame&nbsp;&nbsp; Home
          All
        </span>
      </footer>
    </main>
  );
}

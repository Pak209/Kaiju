import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { EditableItem, SceneExport } from "./types";
import { threeToUnity, unityToThree } from "./core";
import { frameDistance, tintLockedMaterial } from "./viewportUtils";
import {
  createAssetIndex,
  normalizeBundlePath,
  resolveSceneGlb,
} from "./assetResolution";
import { groupForEntry, type SceneGroup } from "./sceneGroups";
import { createPublicTerminalModel, isPublicTerminalAsset } from "./publicTerminal";
import { createHabitatStackModel, isHabitatStackAsset } from "./habitatStack";
type Props = {
  scene: SceneExport;
  editable: EditableItem[];
  files: Map<string, File>;
  selected: string[];
  mode: "translate" | "rotate" | "scale";
  snap: boolean;
  frameRequest: {
    sequence: number;
    target: "all" | "selection" | "hero" | "top";
  };
  compositionGuides: boolean;
  hiddenGroups: Set<SceneGroup>;
  groupOverrides: Partial<Record<string, SceneGroup>>;
  onAssetStats: (stats: {
    loaded: number;
    failed: number;
    total: number;
    available: number;
  }) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  onCommitMany: (
    changes: { id: string; transform: EditableItem["transform"] }[],
  ) => void;
};
export default function Viewport(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(p);
  live.current = p;
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x172330);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x172330, 60, 160);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(28, 24, 32);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 2, 0);
    orbit.update();
    const light = new THREE.HemisphereLight(0xddeeff, 0x283828, 2.2);
    scene.add(light);
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(20, 30, 15);
    sun.castShadow = true;
    scene.add(sun);
    const grid = new THREE.GridHelper(160, 160, 0x426078, 0x263a4a);
    scene.add(grid);
    const compositionGuide = new THREE.Group();
    const guideMaterial = new THREE.LineBasicMaterial({
      color: 0x55d6be,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    for (const radius of [25, 70, 110]) {
      const points = Array.from({ length: 96 }, (_, index) => {
        const angle = (index / 96) * Math.PI * 2;
        return new THREE.Vector3(
          Math.cos(angle) * radius,
          0.08,
          Math.sin(angle) * radius,
        );
      });
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        guideMaterial,
      );
      compositionGuide.add(ring);
    }
    const spokeGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-110, 0.08, 0),
      new THREE.Vector3(110, 0.08, 0),
      new THREE.Vector3(0, 0.08, -110),
      new THREE.Vector3(0, 0.08, 110),
    ]);
    compositionGuide.add(
      new THREE.LineSegments(spokeGeometry, guideMaterial),
    );
    compositionGuide.visible = p.compositionGuides;
    scene.add(compositionGuide);
    const root = new THREE.Group();
    scene.add(root);
    const objects = new Map<string, THREE.Object3D>();
    const entriesById = new Map(
      p.scene.entries.map((entry) => [entry.id, entry]),
    );
    const normalizePath = normalizeBundlePath;
    const assetIndex = createAssetIndex(p.files);
    const resolvedPaths = new Map(
      p.scene.entries.map((entry) => [
        entry.id,
        resolveSceneGlb(entry, assetIndex),
      ]),
    );
    const blobUrls = new Map<string, string>();
    const loadingManager = new THREE.LoadingManager();
    loadingManager.setURLModifier((url) => {
      if (url.startsWith("blob:") || url.startsWith("data:")) return url;
      const path = normalizePath(url);
      const file = live.current.files.get(path);
      if (!file) return url;
      let blobUrl = blobUrls.get(path);
      if (!blobUrl) {
        blobUrl = URL.createObjectURL(file);
        blobUrls.set(path, blobUrl);
      }
      return blobUrl;
    });
    const loader = new GLTFLoader(loadingManager);
    const assetCache = new Map<string, Promise<THREE.Object3D>>();
    const assetStates = new Map<string, "loaded" | "failed">();
    const assetPaths = [
      ...new Set([...resolvedPaths.values()].filter(Boolean)),
    ] as string[];
    let firstLoadErrorLogged = false;
    const reportAssetStats = () => {
      let loaded = 0;
      let failed = 0;
      for (const state of assetStates.values()) {
        if (state === "loaded") loaded += 1;
        else failed += 1;
      }
      live.current.onAssetStats({
        loaded,
        failed,
        total: assetPaths.length,
        available: assetIndex.paths.length,
      });
    };
    reportAssetStats();
    const fallback = (e: SceneExport["entries"][number], failed = false) => {
      // A Public Terminal is code-authored, so an absent placeholder GLB is not an asset failure.
      if (isPublicTerminalAsset(e.name, e.prefabPath)) {
        const terminal = createPublicTerminalModel();
        terminal.userData.assetProxy = true;
        return terminal;
      }
      if (isHabitatStackAsset(e.name, e.prefabPath)) {
        const habitat = createHabitatStackModel();
        habitat.userData.assetProxy = true;
        return habitat;
      }
      const s =
        e.boundsSize ??
        (e.name.toLowerCase().includes("terrain") ? [50, 0.3, 40] : [2, 2, 2]);
      const g = new THREE.BoxGeometry(...s);
      const m = new THREE.MeshStandardMaterial({
        color: failed ? 0xd83f46 : e.editable ? 0x8199aa : 0x8b765b,
        emissive: failed ? 0x3b080b : 0x000000,
        roughness: 0.8,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.userData.assetFailed = failed;
      mesh.userData.assetProxy = !failed;
      mesh.position.y = s[1] / 2;
      if (!e.editable && !failed) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(g),
          new THREE.LineBasicMaterial({
            color: 0xc69a5a,
            transparent: true,
            opacity: 0.18,
          }),
        );
        edges.userData.assetProxy = true;
        edges.position.copy(mesh.position);
        g.dispose();
        m.dispose();
        return edges;
      }
      return mesh;
    };
    const loadAsset = (glbPath: string) => {
      const path = normalizePath(glbPath);
      const cached = assetCache.get(path);
      if (cached) return cached;

      const promise = (async () => {
        const file = live.current.files.get(path);
        if (!file) {
          throw new Error(`Bundle does not contain referenced GLB: ${path}`);
        }
        const parsed = await loader.loadAsync(`holocity://bundle/${path}`);
        return parsed.scene;
      })()
        .then((loaded) => {
          assetStates.set(path, "loaded");
          reportAssetStats();
          return loaded;
        })
        .catch((error: unknown) => {
          assetStates.set(path, "failed");
          reportAssetStats();
          if (!firstLoadErrorLogged) {
            firstLoadErrorLogged = true;
            console.error("[HoloCity Placer] First GLB load failure", {
              glb: path,
              error,
            });
          }
          throw error;
        });
      assetCache.set(path, promise);
      return promise;
    };
    const addEntry = async (e: SceneExport["entries"][number]) => {
      let visual: THREE.Object3D;
      const resolvedPath = resolvedPaths.get(e.id);
      let loadedRealAsset = false;
      try {
        if (resolvedPath) {
          visual = (await loadAsset(resolvedPath)).clone(true);
          loadedRealAsset = true;
        } else {
          visual = fallback(e);
        }
      } catch {
        visual = fallback(e, true);
      }
      const holder = new THREE.Group();
      holder.userData = { id: e.id, editable: e.editable, loadedRealAsset };
      holder.add(visual);
      const t = unityToThree(e.transform);
      holder.position.fromArray(t.position);
      holder.quaternion.fromArray(t.rotation);
      holder.scale.fromArray(t.scale);
      visual.traverse((o) => {
        o.userData.owner = holder;
        if ((o as THREE.Mesh).isMesh) {
          (o as THREE.Mesh).castShadow = true;
          (o as THREE.Mesh).receiveShadow = true;
          if (!e.editable && !o.userData.assetFailed) {
            const mesh = o as THREE.Mesh;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(tintLockedMaterial)
              : tintLockedMaterial(mesh.material);
          }
        }
      });
      root.add(holder);
      objects.set(e.id, holder);
    };
    const frameObjects = (targets: THREE.Object3D[]) => {
      const box = new THREE.Box3();
      let hasBounds = false;
      for (const target of targets) {
        if (!target.visible) continue;
        const targetBox = new THREE.Box3().setFromObject(target);
        if (targetBox.isEmpty()) continue;
        box.union(targetBox);
        hasBounds = true;
      }
      if (!hasBounds) return;

      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.5);
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const distance = frameDistance(radius, verticalFov, camera.aspect);
      const direction = camera.position.clone().sub(orbit.target).normalize();
      if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.5) {
        direction.set(1, 0.75, 1).normalize();
      }
      orbit.target.copy(sphere.center);
      camera.position.copy(sphere.center).addScaledVector(direction, distance);
      camera.near = Math.max(0.01, distance / 1000);
      camera.far = Math.max(500, distance + radius * 8);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = Math.max(radius * 2, distance * 0.65);
        scene.fog.far = distance + radius * 4;
      }
      camera.updateProjectionMatrix();
      orbit.update();
    };
    void Promise.all(p.scene.entries.map(addEntry)).then(() => {
      requestAnimationFrame(() => {
        const realAssets = [...objects.values()].filter(
          (object) => object.userData.loadedRealAsset,
        );
        frameObjects(realAssets.length ? realAssets : [...objects.values()]);
      });
    });
    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());
    transform.addEventListener(
      "dragging-changed",
      (e) => (orbit.enabled = !e.value),
    );
    let dragState:
      | {
          primary: string;
          primaryMatrix: THREE.Matrix4;
          otherMatrices: Map<string, THREE.Matrix4>;
        }
      | undefined;
    transform.addEventListener("mouseDown", () => {
      const primary = transform.object;
      if (!primary) return;
      scene.updateMatrixWorld(true);
      const otherMatrices = new Map<string, THREE.Matrix4>();
      for (const id of live.current.selected) {
        const object = objects.get(id);
        if (object && object !== primary) {
          otherMatrices.set(id, object.matrixWorld.clone());
        }
      }
      dragState = {
        primary: primary.userData.id,
        primaryMatrix: primary.matrixWorld.clone(),
        otherMatrices,
      };
    });
    transform.addEventListener("objectChange", () => {
      const primary = transform.object;
      if (!dragState || !primary || !transform.dragging) return;
      primary.updateMatrixWorld(true);
      const inverseStart = dragState.primaryMatrix.clone().invert();
      const delta = primary.matrixWorld.clone().multiply(inverseStart);
      for (const [id, start] of dragState.otherMatrices) {
        const object = objects.get(id);
        if (!object) continue;
        const nextWorld = delta.clone().multiply(start);
        nextWorld.decompose(object.position, object.quaternion, object.scale);
        object.updateMatrixWorld(true);
      }
    });
    transform.addEventListener("mouseUp", () => {
      if (!dragState) return;
      const changes = live.current.selected.flatMap((id) => {
        const object = objects.get(id);
        if (!object) return [];
        return [
          {
            id,
            transform: threeToUnity({
              position: object.position.toArray() as [number, number, number],
              rotation: object.quaternion.toArray() as [
                number,
                number,
                number,
                number,
              ],
              scale: object.scale.toArray() as [number, number, number],
            }),
          },
        ];
      });
      dragState = undefined;
      if (changes.length) live.current.onCommitMany(changes);
    });
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2();
    const click = (ev: PointerEvent) => {
      if (transform.dragging) return;
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        (-(ev.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(root.children, true)[0];
      if (!hit) {
        live.current.onSelect(null, ev.shiftKey);
        return;
      }
      let owner: THREE.Object3D | undefined = hit.object.userData.owner;
      while (owner && !owner.userData.id) owner = owner.parent ?? undefined;
      live.current.onSelect(
        owner?.userData.editable ? owner.userData.id : null,
        ev.shiftKey,
      );
    };
    renderer.domElement.addEventListener("pointerdown", click);
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      renderer.render(scene, camera);
    };
    tick();
    let lastFrameSequence = p.frameRequest.sequence;
    const sync = () => {
      const q = live.current;
      compositionGuide.visible = q.compositionGuides;
      for (const [id, object] of objects) {
        const entry = entriesById.get(id);
        object.visible = entry
          ? !q.hiddenGroups.has(groupForEntry(entry, q.groupOverrides))
          : true;
      }
      for (const item of q.editable) {
        let o = objects.get(item.id);
        if (!o) {
          // Manifest entries are created by addEntry(). Creating a proxy here while
          // their GLB is still loading leaves an orphaned box when the real mesh
          // arrives. Only session-added objects lack a manifest entry.
          if (entriesById.has(item.id)) continue;
          const synthetic = {
            id: item.id,
            name: item.name,
            editable: true,
            transform: item.transform,
            boundsSize: [2, 1, 2] as [number, number, number],
          };
          o = new THREE.Group();
          o.userData = { id: item.id, editable: true };
          const visual = fallback(synthetic);
          visual.traverse((v) => (v.userData.owner = o));
          o.add(visual);
          root.add(o);
          objects.set(item.id, o);
        }
        const entry = entriesById.get(item.id);
        o.visible =
          !item.deleted &&
          (!entry ||
            !q.hiddenGroups.has(groupForEntry(entry, q.groupOverrides)));
        if (!(transform.dragging && q.selected.includes(item.id))) {
          const t = unityToThree(item.transform);
          o.position.fromArray(t.position);
          o.quaternion.fromArray(t.rotation);
          o.scale.fromArray(t.scale);
        }
      }
      const primaryId = q.selected.at(-1);
      const selected = primaryId ? objects.get(primaryId) : undefined;
      if (selected && selected.visible) {
        transform.attach(selected);
        transform.setMode(q.mode);
        transform.setTranslationSnap(q.snap ? 0.25 : null);
        transform.setRotationSnap(q.snap ? THREE.MathUtils.degToRad(15) : null);
        transform.setScaleSnap(q.snap ? 0.1 : null);
      } else transform.detach();

      if (q.frameRequest.sequence !== lastFrameSequence) {
        lastFrameSequence = q.frameRequest.sequence;
        if (q.frameRequest.target === "selection") {
          const targets = q.selected.flatMap((id) => {
            const object = objects.get(id);
            return object?.visible ? [object] : [];
          });
          if (targets.length) frameObjects(targets);
        } else if (q.frameRequest.target === "hero") {
          camera.fov = 48;
          camera.position.set(0, 24, 205);
          orbit.target.set(0, 14, -5);
          camera.near = 0.1;
          camera.far = 650;
          camera.updateProjectionMatrix();
          orbit.update();
        } else if (q.frameRequest.target === "top") {
          camera.fov = 45;
          camera.position.set(0, 260, 0.01);
          orbit.target.set(0, 0, 0);
          camera.near = 0.1;
          camera.far = 650;
          camera.updateProjectionMatrix();
          orbit.update();
        } else {
          const realAssets = [...objects.values()].filter(
            (object) => object.userData.loadedRealAsset,
          );
          frameObjects(realAssets.length ? realAssets : [...objects.values()]);
        }
      }
    };
    const timer = setInterval(sync, 50);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", click);
      for (const url of blobUrls.values()) URL.revokeObjectURL(url);
      compositionGuide.traverse((object) => {
        const line = object as THREE.Line;
        line.geometry?.dispose();
      });
      guideMaterial.dispose();
      renderer.dispose();
      el.replaceChildren();
    };
  }, [p.scene, p.files]);
  return (
    <div className="viewport" ref={host}>
      <div className="view-tools">
        LMB select · Shift+LMB multi-select · RMB orbit · Shift+RMB pan · wheel
        zoom · F selection · Home all
      </div>
    </div>
  );
}

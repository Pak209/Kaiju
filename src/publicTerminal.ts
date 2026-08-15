import * as THREE from "three";

/** Code-authored fallback for the HoloCity Public Terminal, facing +Z. */
export const isPublicTerminalAsset = (name: string, prefabPath = "") =>
  /public[-_ ]?terminal/i.test(`${name} ${prefabPath}`);

const roundedPanel = (width: number, height: number, radius: number, depth: number) => {
  const x = width / 2, y = height / 2, r = Math.min(radius, x, y);
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r); s.quadraticCurveTo(x, y, x - r, y); s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r); s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 10 }).translate(0, 0, -depth / 2);
};

const slabFoot = () => {
  const s = new THREE.Shape();
  s.moveTo(-0.25, 0); s.lineTo(0.25, 0); s.lineTo(0.2, 0.18); s.lineTo(-0.15, 0.25); s.lineTo(-0.28, 0.12); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.62, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.025, bevelSegments: 2 }).translate(0, 0, -0.31);
};

const rail = (side: number) => new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.3, 0.3, 0.12),
    new THREE.Vector3(side * 0.45, 0.72, 0.2),
    new THREE.Vector3(side * 0.42, 1.72, 0.29),
    new THREE.Vector3(side * 0.31, 2.82, 0.37),
    new THREE.Vector3(side * 0.17, 3.23, 0.34),
  ]), 24, 0.07, 8, false,
);

export function createPublicTerminalModel() {
  const root = new THREE.Group();
  root.name = "public-terminal";
  const runtime = {
    nodes: {} as Record<string, THREE.Object3D>,
    sockets: {} as Record<string, THREE.Object3D>,
    destructionGroups: ["chassis", "display-hood", "lower-mechanism", "right-service-module", "feet"],
    colliders: [{ id: "terminal-chassis", type: "box", size: [0.88, 3.2, 0.68] }],
  };
  root.userData.sculptRuntime = runtime;
  const white = new THREE.MeshStandardMaterial({ color: 0xe7ece8, roughness: 0.4, metalness: 0.16 });
  const whiteEdge = new THREE.MeshStandardMaterial({ color: 0xf7fbf5, roughness: 0.31, metalness: 0.25 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x10181c, roughness: 0.32, metalness: 0.66 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x273338, roughness: 0.45, metalness: 0.8 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf0b908, roughness: 0.29, metalness: 0.7 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x4be9ee, emissive: 0x057d90, emissiveIntensity: 2.8, roughness: 0.16, metalness: 0.12 });
  const add = (id: string, object: THREE.Object3D, group: string) => {
    const pivot = new THREE.Group(); pivot.name = id; pivot.userData = { partId: id, destructionGroup: group };
    object.name = `${id}-mesh`; pivot.add(object); root.add(pivot); runtime.nodes[id] = pivot; return pivot;
  };
  const detail = (id: string, object: THREE.Object3D, parent?: THREE.Object3D) => {
    object.name = id; object.userData.explodeWithParent = true; (parent ?? root).add(object); return object;
  };

  // Separate chassis replaces the old continuous white monolith.
  const chassis = new THREE.Mesh(roundedPanel(0.74, 2.78, 0.15, 0.54), carbon);
  chassis.position.set(0, 1.68, 0); add("exposed-dark-chassis", chassis, "chassis");
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.17, 2.58, 0.62), darkMetal);
  spine.position.set(0.18, 1.55, -0.11); add("rear-spine", spine, "chassis");

  // Thin side rails and top bridge deliberately leave the lower mechanics exposed.
  add("left-white-edge-rail", new THREE.Mesh(rail(-1), white), "chassis");
  add("right-white-edge-rail", new THREE.Mesh(rail(1), white), "chassis");
  const topBridge = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 6, 14, Math.PI), whiteEdge);
  topBridge.rotation.set(0, 0, Math.PI); topBridge.position.set(0, 3.2, 0.35); add("arched-top-bridge", topBridge, "chassis");
  for (const side of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 2.05, 6), yellow);
    trim.position.set(side * 0.5, 1.73, 0.36); trim.rotation.z = side * -0.08;
    detail(`${side < 0 ? "left" : "right"}-yellow-edge-trim`, trim);
  }

  // The screen has a thick, canted carbon hood; display occupies most of upper front.
  const hood = new THREE.Mesh(roundedPanel(0.88, 1.6, 0.13, 0.31), carbon);
  hood.position.set(-0.025, 2.43, 0.42); hood.rotation.x = -0.29; add("deep-canted-screen-hood", hood, "display-hood");
  const frame = new THREE.Mesh(roundedPanel(0.78, 1.45, 0.11, 0.09), yellow);
  frame.position.set(-0.025, 2.45, 0.61); frame.rotation.x = -0.29; add("yellow-screen-rail", frame, "display-hood");
  const screen = new THREE.Mesh(roundedPanel(0.64, 1.23, 0.075, 0.032), cyan);
  screen.position.set(-0.025, 2.45, 0.68); screen.rotation.x = -0.29; add("large-cyan-inset-display", screen, "display-hood");

  // Open lower-front mechanism: panel stack, intake, controls, and cyan state lamps.
  const lowerFrame = new THREE.Mesh(roundedPanel(0.68, 0.9, 0.08, 0.15), darkMetal);
  lowerFrame.position.set(-0.07, 0.96, 0.32); add("lower-mechanical-frame", lowerFrame, "lower-mechanism");
  const intake = new THREE.Mesh(roundedPanel(0.42, 0.48, 0.06, 0.06), carbon);
  intake.position.set(-0.14, 0.95, 0.43); add("lower-intake-module", intake, "lower-mechanism");
  for (let i = 0; i < 4; i += 1) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.045, 0.035), yellow);
    vent.position.set(-0.14, 1.12 - i * 0.11, 0.48); detail(`intake-vent-${i + 1}`, vent);
  }
  for (const x of [-0.34, 0.14]) {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 12), cyan);
    lamp.rotation.x = Math.PI / 2; lamp.position.set(x, 0.57, 0.43); detail(`lower-status-lamp-${x}`, lamp);
  }
  const controlBlock = new THREE.Mesh(roundedPanel(0.25, 0.38, 0.04, 0.09), carbon);
  controlBlock.position.set(0.28, 1.03, 0.44); add("lower-control-block", controlBlock, "lower-mechanism");

  // Intentionally asymmetric right-side service hardware.
  const sidePod = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.46, 6, 10), darkMetal);
  sidePod.position.set(0.55, 0.72, 0.03); sidePod.rotation.z = -0.16; add("right-service-pod", sidePod, "right-service-module");
  const actuator = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.54, 10), carbon);
  actuator.position.set(0.58, 1.03, 0.15); actuator.rotation.z = -0.16; add("right-actuator", actuator, "right-service-module");
  for (let i = 0; i < 3; i += 1) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), yellow);
    band.position.set(0.67, 0.56 + i * 0.21, 0.19); band.rotation.z = -0.16; detail(`right-service-band-${i + 1}`, band);
  }
  const leftBrace = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.66, 8), darkMetal);
  leftBrace.position.set(-0.48, 0.57, 0.05); leftBrace.rotation.z = 0.22; add("left-chassis-brace", leftBrace, "lower-mechanism");

  // Two faceted slab feet, not a circular plinth/ring.
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(slabFoot(), carbon);
    foot.position.set(side * 0.28, 0.04, 0.02); foot.rotation.y = side * 0.08; add(`${side < 0 ? "left" : "right"}-split-slab-foot`, foot, "feet");
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.035, 0.48), yellow);
    tread.position.set(side * 0.28, 0.22, 0.05); tread.rotation.y = side * 0.08; detail(`${side < 0 ? "left" : "right"}-foot-edge-rail`, tread);
  }
  for (const [x, y] of [[-0.43, 1.42], [0.42, 1.28], [0.43, 2.98]]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.025, 8), darkMetal);
    bolt.rotation.x = Math.PI / 2; bolt.position.set(x, y, 0.4); detail(`recessed-bolt-${x}-${y}`, bolt);
  }
  const interaction = new THREE.Object3D(); interaction.name = "interaction-socket"; interaction.position.set(0, 1.75, 0.98); root.add(interaction); runtime.sockets.interaction = interaction;
  return root;
}

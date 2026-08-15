import * as THREE from "three";

export const isHabitatStackAsset = (name: string, prefabPath = "") =>
  /habitat[-_ ]?stack/i.test(`${name} ${prefabPath}`);

const beam = (a: THREE.Vector3, b: THREE.Vector3, width: number, material: THREE.Material) => {
  const direction = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(width, width, direction.length(), 6), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
};

/** Dense, gravity-supported residential megastructure; faces +Z. */
export function createHabitatStackModel() {
  const root = new THREE.Group(); root.name = "habitat-stack";
  const runtime = {
    nodes: {} as Record<string, THREE.Object3D>, sockets: {} as Record<string, THREE.Object3D>,
    destructionGroups: ["podium", "floor-frames", "residential-bays", "roof-services"],
    colliders: [{ id: "habitat-podium", type: "box", size: [5.2, 1.1, 2.5] }, { id: "habitat-stack", type: "box", size: [4.8, 5.6, 2.4] }],
  };
  root.userData.sculptRuntime = runtime;
  const composite = new THREE.MeshStandardMaterial({ color: 0xd9dfdc, roughness: 0.53, metalness: 0.15 });
  const lightComposite = new THREE.MeshStandardMaterial({ color: 0xf2f2e9, roughness: 0.43, metalness: 0.12 });
  const panelGray = new THREE.MeshStandardMaterial({ color: 0x8fa3a3, roughness: 0.55, metalness: 0.28 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x182529, roughness: 0.38, metalness: 0.78 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x1f91aa, emissive: 0x063946, emissiveIntensity: 0.65, roughness: 0.18, metalness: 0.4 });
  const darkWindow = new THREE.MeshStandardMaterial({ color: 0x102c35, emissive: 0x021216, emissiveIntensity: 0.2, roughness: 0.22, metalness: 0.5 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xddad18, roughness: 0.32, metalness: 0.66 });
  const foliage = new THREE.MeshStandardMaterial({ color: 0x4e8055, roughness: 0.86, metalness: 0 });
  const foliageLight = new THREE.MeshStandardMaterial({ color: 0x6b9860, roughness: 0.84, metalness: 0 });
  const foliageDark = new THREE.MeshStandardMaterial({ color: 0x315a42, roughness: 0.9, metalness: 0 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x3d3328, roughness: 0.94, metalness: 0 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4030, roughness: 0.82, metalness: 0 });
  // Shared deterministic vegetation geometry keeps the dressing inexpensive.
  const trunkGeometry = new THREE.CylinderGeometry(0.04, 0.065, 1, 7);
  const canopyGeometry = new THREE.IcosahedronGeometry(0.24, 1);
  const shrubGeometry = new THREE.DodecahedronGeometry(0.14, 0);
  const add = (id: string, object: THREE.Object3D, group: string) => { const pivot = new THREE.Group(); pivot.name = id; pivot.userData = { partId: id, destructionGroup: group }; object.name = `${id}-mesh`; pivot.add(object); root.add(pivot); runtime.nodes[id] = pivot; return pivot; };
  const detail = (id: string, object: THREE.Object3D, parent = root) => { object.name = id; object.userData.explodeWithParent = true; parent.add(object); return object; };
  const box = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number, parent = root, id?: string) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material); mesh.position.set(x, y, z); return id ? detail(id, mesh, parent) : mesh; };
  const addVegetationZone = (id: string, x: number, y: number, z: number, width: number, depth: number, profile: readonly [number, number, number, number, number][], vines = 0) => {
    const zone = new THREE.Group(); zone.name = id; zone.position.set(x, y, z); zone.userData = { partId: id, destructionGroup: "vegetation" }; root.add(zone); runtime.nodes[id] = zone;
    const planter = new THREE.Mesh(new THREE.BoxGeometry(width, 0.17, depth), frame); planter.position.y = 0.085; detail(`${id}-attached-planter`, planter, zone);
    const soilBed = new THREE.Mesh(new THREE.BoxGeometry(width * 0.84, 0.05, depth * 0.7), soil); soilBed.position.y = 0.19; detail(`${id}-visible-soil-bed`, soilBed, zone);
    for (const [px, pz, height, spread, colorIndex] of profile) {
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial); trunk.position.set(px, 0.2 + height * 0.5, pz); trunk.scale.set(1, height, 1); detail(`${id}-trunk-${px}-${pz}`, trunk, zone);
      const palette = [foliage, foliageLight, foliageDark];
      for (const [lobe, dx, dz, scale] of [[0, 0, 0, 1], [1, -0.14, 0.07, 0.74], [2, 0.13, -0.09, 0.82], [3, 0.04, 0.14, 0.65]] as const) {
        const crown = new THREE.Mesh(canopyGeometry, palette[(colorIndex + lobe) % palette.length]);
        crown.position.set(px + dx * spread, 0.2 + height + (lobe === 0 ? 0.08 : 0.02), pz + dz * spread);
        crown.scale.set(spread * scale, spread * (0.8 + lobe * 0.04), spread * scale); crown.rotation.set(lobe * 0.31, (colorIndex + lobe) * 0.57, lobe * -0.19);
        detail(`${id}-canopy-${px}-${pz}-${lobe}`, crown, zone);
      }
    }
    for (let shrub = 0; shrub < Math.max(2, Math.round(width * 2)); shrub += 1) {
      const plant = new THREE.Mesh(shrubGeometry, [foliageDark, foliage, foliageLight][shrub % 3]);
      plant.position.set(-width * 0.32 + (shrub % 4) * width * 0.2, 0.31 + (shrub % 2) * 0.025, depth * 0.18 - (shrub % 3) * depth * 0.12);
      plant.scale.set(0.65 + (shrub % 2) * 0.22, 0.7 + (shrub % 3) * 0.1, 0.65 + ((shrub + 1) % 2) * 0.18); plant.rotation.y = shrub * 0.63; detail(`${id}-compact-shrub-${shrub}`, plant, zone);
    }
    for (let vine = 0; vine < vines; vine += 1) for (let segment = 0; segment < 3; segment += 1) {
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, 0.22, 6), foliageDark);
      strand.position.set(-width * 0.34 + vine * width * 0.25 + Math.sin(segment + vine) * 0.025, -0.1 - segment * 0.19, depth * 0.4);
      strand.rotation.z = (vine % 2 ? -1 : 1) * 0.16; detail(`${id}-trailing-vine-${vine}-${segment}`, strand, zone);
    }
  };

  // A broad, weighty podium establishes an actual ground-level load path.
  const podium = new THREE.Mesh(new THREE.BoxGeometry(5.15, 0.92, 2.45), frame); podium.position.set(0, 0.46, 0); add("ground-level-podium", podium, "podium");
  const podiumCap = new THREE.Mesh(new THREE.BoxGeometry(5.34, 0.18, 2.62), panelGray); podiumCap.position.set(0, 0.98, 0); add("podium-transfer-cap", podiumCap, "podium");
  for (const [x, width, label] of [[-1.75, 1.15, "market"], [-0.35, 1.28, "lobby"], [1.28, 1.4, "service"]] as const) {
    box(width, 0.56, 0.045, darkWindow, x, 0.48, 1.25, root, `podium-${label}-storefront`);
    box(width * 0.75, 0.035, 0.045, windowMat, x, 0.67, 1.29, root, `podium-${label}-lightband`);
    for (let pane = 0; pane < 3; pane += 1) box(0.035, 0.51, 0.05, frame, x - width * 0.26 + pane * width * 0.26, 0.48, 1.3, root, `podium-${label}-mullion-${pane + 1}`);
  }
  for (const [x, width, label] of [[-1.45, 1.12, "loading"], [0.18, 1.28, "service"], [1.63, 0.86, "utility"]] as const) {
    box(width, 0.58, 0.05, darkWindow, x, 0.48, -1.25, root, `podium-rear-${label}-door`);
    box(width * 0.86, 0.04, 0.05, yellow, x, 0.78, -1.29, root, `podium-rear-${label}-header`);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, 0.08, 0.42), frame); canopy.position.set(x, 0.92, -1.42); detail(`podium-rear-${label}-canopy`, canopy);
  }
  for (const x of [-2.28, -1.12, 0.78, 2.22]) { const column = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.0, 0.27), frame); column.position.set(x, 0.5, 0.94); add(`podium-front-column-${x}`, column, "podium"); }

  const floors = [
    { id: "floor-01", y: 1.27, width: 4.5, depth: 3.28, offset: -0.08, rooms: [[-1.42, 1.45, 1.48, 1.05, 0.02], [0.12, 1.32, 1.62, 1.18, -0.04], [1.55, 1.2, 1.42, 1.0, 0.08]] },
    { id: "floor-02", y: 2.35, width: 4.82, depth: 3.5, offset: 0.12, rooms: [[-1.6, 1.3, 1.56, 1.18, -0.08], [-0.18, 1.52, 1.42, 1.05, 0.1], [1.42, 1.42, 1.72, 1.25, -0.05]] },
    { id: "floor-03", y: 3.45, width: 4.6, depth: 3.44, offset: -0.18, rooms: [[-1.45, 1.48, 1.66, 1.23, 0.04], [0.13, 1.16, 1.45, 1.0, -0.1], [1.4, 1.4, 1.74, 1.18, 0.1]] },
    { id: "floor-04", y: 4.55, width: 4.95, depth: 3.62, offset: 0.08, rooms: [[-1.7, 1.28, 1.44, 1.12, -0.04], [-0.28, 1.6, 1.78, 1.25, 0.07], [1.42, 1.36, 1.58, 1.12, -0.09]] },
    { id: "floor-05", y: 5.65, width: 4.72, depth: 3.46, offset: -0.06, rooms: [[-1.5, 1.42, 1.72, 1.2, 0.08], [0.03, 1.58, 1.52, 1.18, -0.06], [1.52, 1.08, 1.4, 1.02, 0.11]] },
  ];
  for (const [index, floor] of floors.entries()) {
    const group = new THREE.Group(); group.name = floor.id; group.position.x = floor.offset; group.userData = { partId: floor.id, destructionGroup: "floor-frames" }; root.add(group); runtime.nodes[floor.id] = group;
    // Thick continuous slab binds several true-depth rooms into a believable floor.
    box(floor.width, 0.22, floor.depth, frame, 0, floor.y, 0, group, `${floor.id}-continuous-floor-slab`);
    box(floor.width * 0.95, 0.038, 0.06, yellow, 0, floor.y + 0.94, floor.depth / 2 + 0.04, group, `${floor.id}-thin-safety-trim`);
    for (const room of floor.rooms) {
      const [x, width, depth, height, yaw] = room;
      const roomZ = 0.04 + ((Math.round(x * 10) + index + 6) % 3) * 0.15;
      const roomGroup = new THREE.Group(); roomGroup.name = `${floor.id}-room-${x}`; roomGroup.position.set(x, floor.y + 0.22 + height / 2, roomZ); roomGroup.rotation.y = yaw; group.add(roomGroup);
      const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), index % 2 ? composite : lightComposite); detail(`${floor.id}-room-${x}-facade-body`, body, roomGroup);
      // Separate side volume reads in three-quarter view instead of a flat façade card.
      box(0.09, height * 0.92, depth * 0.76, panelGray, width / 2 + 0.05, 0, -0.02, roomGroup, `${floor.id}-room-${x}-side-cladding`);
      box(width * 0.86, 0.07, 0.06, frame, 0, height * 0.29, depth / 2 + 0.034, roomGroup, `${floor.id}-room-${x}-facade-seam`);
      const paneCols = width > 1.4 ? 4 : 3;
      const paneRows = height > 1.12 ? 3 : 2;
      for (let row = 0; row < paneRows; row += 1) for (let col = 0; col < paneCols; col += 1) {
        const paneWidth = width * 0.16, paneHeight = height * 0.17;
        const pane = new THREE.Mesh(new THREE.BoxGeometry(paneWidth, paneHeight, 0.028), (row + col + index) % 3 === 0 ? darkWindow : windowMat);
        pane.position.set(-width * 0.27 + col * width * 0.18, height * 0.08 - row * height * 0.22, depth / 2 + 0.035); detail(`${floor.id}-room-${x}-window-${row}-${col}`, pane, roomGroup);
        const rearPane = new THREE.Mesh(new THREE.BoxGeometry(paneWidth, paneHeight, 0.028), (row + col + index + 1) % 3 === 0 ? darkWindow : windowMat);
        rearPane.position.set(-width * 0.27 + col * width * 0.18, height * 0.08 - row * height * 0.22, -depth / 2 - 0.035); detail(`${floor.id}-room-${x}-rear-window-${row}-${col}`, rearPane, roomGroup);
      }
      // Fragmented panel cladding gives rooms seams and solid regions between glazing grids.
      for (const side of [-1, 1]) box(0.08, height * 0.8, 0.04, panelGray, side * width * 0.42, 0, depth / 2 + 0.045, roomGroup, `${floor.id}-room-${x}-panel-pier-${side}`);
      for (let row = 0; row < 2; row += 1) for (let side = 0; side < 2; side += 1) box(0.04, height * 0.24, depth * 0.22, side === 0 ? panelGray : darkWindow, width / 2 + 0.055, height * 0.13 - row * height * 0.28, -depth * 0.2 + side * depth * 0.4, roomGroup, `${floor.id}-room-${x}-side-grid-${row}-${side}`);
      if ((index + Math.round(x * 10)) % 3 === 0) { const rearDoor = new THREE.Mesh(new THREE.BoxGeometry(width * 0.24, height * 0.58, 0.035), frame); rearDoor.position.set(width * 0.28, -height * 0.06, -depth / 2 - 0.038); detail(`${floor.id}-room-${x}-rear-utility-door`, rearDoor, roomGroup); }
      if (width > 1.3 && index !== 1) {
        const balcony = new THREE.Mesh(new THREE.BoxGeometry(width * 0.65, 0.1, 0.42), frame); balcony.position.set(-width * 0.06, -height / 2 - 0.08, depth / 2 + 0.22); detail(`${floor.id}-room-${x}-balcony-slab`, balcony, roomGroup);
        for (let rail = 0; rail < 5; rail += 1) box(0.025, 0.34, 0.025, panelGray, -width * 0.28 + rail * width * 0.14, -height / 2 + 0.08, depth / 2 + 0.4, roomGroup, `${floor.id}-room-${x}-balcony-upright-${rail}`);
        box(width * 0.62, 0.025, 0.025, frame, -width * 0.06, -height / 2 + 0.25, depth / 2 + 0.4, roomGroup, `${floor.id}-room-${x}-balcony-toprail`);
      }
      if ((index + Math.round(x * 10)) % 2 === 0) { const ac = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.17), frame); ac.position.set(width * 0.25, -height * 0.24, depth / 2 + 0.12); detail(`${floor.id}-room-${x}-ac-unit`, ac, roomGroup); }
    }
    // Paired columns and transfer trusses connect every plate to the level below.
    for (const worldX of [-1.55, 1.55]) { const column = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.92, 0.18), frame); column.position.set(worldX - floor.offset, floor.y - 0.51, -floor.depth * 0.32); detail(`${floor.id}-load-column-${worldX}`, column, group); }
    if (index > 0) {
      detail(`${floor.id}-transfer-a`, beam(new THREE.Vector3(-floor.width * 0.38, floor.y - 0.9, -floor.depth * 0.34), new THREE.Vector3(floor.width * 0.38, floor.y - 0.1, -floor.depth * 0.34), 0.05, yellow), group);
      detail(`${floor.id}-transfer-b`, beam(new THREE.Vector3(-floor.width * 0.38, floor.y - 0.1, -floor.depth * 0.34), new THREE.Vector3(floor.width * 0.38, floor.y - 0.9, -floor.depth * 0.34), 0.05, yellow), group);
    }
    if (index === 1 || index === 3) {
      const planter = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 0.34), frame); planter.position.set(-floor.width * 0.24, floor.y + 0.77, floor.depth * 0.36); detail(`${floor.id}-terrace-planter`, planter, group);
      for (let tree = 0; tree < 4; tree += 1) { const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.28, 6), frame); trunk.position.set(-floor.width * 0.52 + tree * 0.24, floor.y + 0.96, floor.depth * 0.36); detail(`${floor.id}-terrace-tree-trunk-${tree}`, trunk, group); const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.13 + (tree % 2) * 0.035, 8, 6), foliage); canopy.position.set(-floor.width * 0.52 + tree * 0.24, floor.y + 1.14, floor.depth * 0.36); detail(`${floor.id}-terrace-tree-canopy-${tree}`, canopy, group); }
    }
    // Rear access catwalk is narrow but navigable, with a door and safety cage rather than blank back plates.
    const catwalk = new THREE.Mesh(new THREE.BoxGeometry(floor.width * 0.58, 0.08, 0.42), frame); catwalk.position.set(0, floor.y + 0.08, -floor.depth / 2 - 0.2); detail(`${floor.id}-rear-access-catwalk`, catwalk, group);
    for (let rail = 0; rail < 6; rail += 1) box(0.025, 0.3, 0.025, panelGray, -floor.width * 0.24 + rail * floor.width * 0.096, floor.y + 0.25, -floor.depth / 2 - 0.38, group, `${floor.id}-rear-catwalk-upright-${rail}`);
    box(floor.width * 0.5, 0.025, 0.025, yellow, 0, floor.y + 0.4, -floor.depth / 2 - 0.38, group, `${floor.id}-rear-catwalk-handrail`);
    const accessDoor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.62, 0.04), frame); accessDoor.position.set(-0.08, floor.y + 0.52, -floor.depth / 2 - 0.04); detail(`${floor.id}-rear-circulation-door`, accessDoor, group);
  }

  // Narrow circulation core: services are broken into doors, vents, risers, and a visible stair rather than a black wall.
  const sideService = new THREE.Mesh(new THREE.BoxGeometry(0.48, 4.35, 0.7), panelGray); sideService.position.set(1.94, 3.48, -0.88); add("east-narrow-circulation-core", sideService, "floor-frames");
  for (const y of [1.62, 2.72, 3.82, 4.92]) { box(0.3, 0.11, 0.04, yellow, 1.94, y, -1.25, root, `east-core-vent-${y}`); const door = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.48, 0.04), frame); door.position.set(1.94, y + 0.28, -1.25); detail(`east-core-access-door-${y}`, door); }
  for (const x of [-2.22, 2.28]) { const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 4.9, 10), darkWindow); pipe.position.set(x, 3.52, -1.38); add(`vertical-utility-pipe-${x}`, pipe, "floor-frames"); for (const y of [1.4, 2.5, 3.6, 4.7, 5.75]) { const collar = new THREE.Mesh(new THREE.TorusGeometry(0.077, 0.018, 6, 10), yellow); collar.rotation.x = Math.PI / 2; collar.position.set(x, y, -1.38); detail(`utility-pipe-collar-${x}-${y}`, collar); } }
  for (let step = 0; step < 7; step += 1) box(0.52, 0.07, 0.25, frame, 1.52, 1.32 + step * 0.18, -1.52 + step * 0.05, root, `east-fire-stair-step-${step}`);

  // Slightly wider upper garden/service roof completes the top-heavy but grounded silhouette.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.95, 0.24, 2.6), frame); roof.position.set(-0.02, 6.72, 0); add("broad-roof-transfer-frame", roof, "roof-services");
  const garden = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.16, 0.82), foliage); garden.position.set(-0.55, 6.92, 0.26); add("roof-garden-terrace", garden, "roof-services");
  for (let i = 0; i < 7; i += 1) { const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.1 + (i % 3) * 0.022, 8, 6), foliage); shrub.position.set(-1.38 + i * 0.28, 7.07 + (i % 2) * 0.04, 0.26 + (i % 2) * 0.16); detail(`roof-garden-plant-${i}`, shrub); }
  for (const x of [-1.82, -0.9, 0.35, 1.45]) { const unit = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.48), frame); unit.position.set(x, 6.99, -0.45); add(`roof-hvac-${x}`, unit, "roof-services"); box(0.31, 0.04, 0.025, yellow, x, 7.04, -0.705, root, `roof-hvac-grille-${x}`); }
  for (const [x, height] of [[-0.12, 0.74], [0.64, 1.05], [1.18, 0.56]]) { const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.035, height, 6), yellow); antenna.position.set(x, 7.04 + height / 2, 0); detail(`roof-antenna-${x}`, antenna); }

  // Vegetation is intentionally clustered by reference zone, never sprayed uniformly across floors.
  addVegetationZone("vegetation-upper-left-roof-crown", -0.9, 6.84, 0.48, 1.45, 0.76, [[-0.32, 0.02, 0.72, 0.62, 1], [0.08, -0.08, 0.88, 0.7, 0], [0.42, 0.1, 0.58, 0.48, 2]], 2);
  addVegetationZone("vegetation-upper-right-terrace", 1.25, 6.84, 0.52, 0.92, 0.62, [[-0.18, 0, 0.46, 0.42, 0], [0.2, 0.08, 0.62, 0.5, 1]], 1);
  // Side-edge planter bases rest directly on continuous floor plates and clear the window façades.
  addVegetationZone("vegetation-level-four-west-ledge", -2.32, 4.67, 0.2, 0.5, 0.7, [[0, 0, 0.42, 0.37, 2]], 1);
  addVegetationZone("vegetation-level-three-east-ledge", 2.08, 3.57, 0.24, 0.5, 0.72, [[0, 0.02, 0.38, 0.34, 1]], 0);
  addVegetationZone("vegetation-left-mid-shrubs", -2.16, 2.47, 0.15, 0.42, 0.58, [[0, 0, 0.28, 0.24, 0]], 2);
  addVegetationZone("vegetation-lower-terrace-shrubs", 1.78, 1.39, 0.34, 0.5, 0.55, [[0.04, 0, 0.24, 0.2, 2]], 0);
  const entry = new THREE.Object3D(); entry.name = "entry-socket"; entry.position.set(0, 0.1, 1.42); root.add(entry); runtime.sockets.entry = entry;
  return root;
}

// Render-parity harness.
//
// Renders a bundle EXACTLY the way the contract says a consumer should:
// Unity-space transforms converted through the app's own `unityToThree`
// (imported from src/core.ts, not reimplemented — a harness with its own
// conversion would happily pass while the app is wrong), applied to the
// per-prefab GLBs at world pose.
//
// Two deliberate failure modes are built in, because a gate that has never
// gone red proves nothing about its own sensitivity:
//   mode=mirror  — skip the handedness conversion (render raw Unity coords)
//   mode=norot   — drop every entry rotation
// Both are historical bug classes on this boundary, and run.mjs REQUIRES
// them to fail the comparison.
//
// Determinism: fixed camera, fixed lights, antialias off, pixelRatio 1,
// flat MeshBasicMaterial-style shading is avoided but lighting is a single
// fixed directional + ambient — cross-GPU rasterization drift is absorbed by
// run.mjs's tolerance, not by loosening the scene.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { unityToThree } from '../../src/core'
import type { SceneExport, Transform } from '../../src/types'

declare global {
  interface Window {
    renderBundle: (mode: 'good' | 'mirror' | 'norot') => Promise<string>
  }
}

window.renderBundle = async (mode) => {
  const scene_export: SceneExport = await (await fetch('/bundle/scene_export.json')).json()

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(640, 480)
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x202830)
  scene.add(new THREE.AmbientLight(0xffffff, 0.7))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4)
  sun.position.set(5, 10, 3)
  scene.add(sun)

  const loader = new GLTFLoader()
  const protos = new Map<string, THREE.Object3D>()

  for (const e of scene_export.entries) {
    if (!e.glb) continue
    let proto = protos.get(e.glb)
    if (!proto) {
      proto = (await loader.loadAsync('/bundle/' + e.glb)).scene
      protos.set(e.glb, proto)
    }
    const inst = proto.clone(true)

    let t: Transform =
      mode === 'mirror'
        ? e.transform // known-bad: raw Unity coords, conversion skipped
        : unityToThree(e.transform)
    if (mode === 'norot') t = { ...t, rotation: [0, 0, 0, 1] } // known-bad: rotations dropped

    inst.position.set(t.position[0], t.position[1], t.position[2])
    inst.quaternion.set(t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3])
    inst.scale.set(t.scale[0], t.scale[1], t.scale[2])
    scene.add(inst)
  }

  const cam = new THREE.PerspectiveCamera(45, 640 / 480, 0.1, 500)
  cam.position.set(16, 10, 16)
  cam.lookAt(0, 0, -1)
  renderer.render(scene, cam)
  return renderer.domElement.toDataURL('image/png')
}

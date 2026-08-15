import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createHabitatStackModel } from "./habitatStack";

export default function HabitatStackPreview() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current!, renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x10191e); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80); camera.position.set(8.2, 6.3, 9.4);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 3.1, 0); controls.update();
    scene.add(new THREE.HemisphereLight(0xc5ebeb, 0x142126, 2.3)); const key = new THREE.DirectionalLight(0xffffff, 3.5); key.position.set(5, 9, 6); key.castShadow = true; scene.add(key); const rim = new THREE.DirectionalLight(0x2ec9db, 1.5); rim.position.set(-5, 4, -4); scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ color: 0x1b2d31, roughness: 0.95 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground, createHabitatStackModel());
    const resize = () => { renderer.setSize(element.clientWidth, element.clientHeight, false); camera.aspect = element.clientWidth / element.clientHeight; camera.updateProjectionMatrix(); }; const observer = new ResizeObserver(resize); observer.observe(element); resize(); let frame = 0; const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); }; render();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); renderer.dispose(); element.replaceChildren(); };
  }, []);
  return <div className="terminal-preview" ref={host} aria-label="Habitat Stack preview" />;
}

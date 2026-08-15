import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createPublicTerminalModel } from "./publicTerminal";

/** A lightweight visual QA route: `?asset=public-terminal`. */
export default function PublicTerminalPreview() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x101b22);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(4.1, 3.1, 5.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.75, 0);
    controls.update();
    scene.add(new THREE.HemisphereLight(0xbfe9ee, 0x172328, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 3.6);
    key.position.set(3.5, 5.5, 4);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x3cd8e8, 1.8);
    rim.position.set(-4, 3, -3);
    scene.add(rim);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5, 64),
      new THREE.MeshStandardMaterial({ color: 0x1a2c32, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground, createPublicTerminalModel());
    const resize = () => {
      renderer.setSize(element.clientWidth, element.clientHeight, false);
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let animation = 0;
    const render = () => {
      animation = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(animation);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      element.replaceChildren();
    };
  }, []);
  return <div className="terminal-preview" ref={host} aria-label="Public Terminal preview" />;
}

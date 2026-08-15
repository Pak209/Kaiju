import * as THREE from "three";

export function frameDistance(
  radius: number,
  verticalFovRadians: number,
  aspect: number,
  padding = 1.12,
) {
  const horizontalFov =
    2 * Math.atan(Math.tan(verticalFovRadians / 2) * aspect);
  const limitingFov = Math.min(verticalFovRadians, horizontalFov);
  return (Math.max(radius, 0.5) / Math.sin(limitingFov / 2)) * padding;
}

export function tintLockedMaterial(source: THREE.Material) {
  const material = source.clone();
  const colorMaterial = material as THREE.Material & { color?: THREE.Color };
  if (colorMaterial.color) {
    colorMaterial.color.lerp(new THREE.Color(0xe6a84b), 0.14);
  }
  return material;
}

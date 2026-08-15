import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { frameDistance, tintLockedMaterial } from "./viewportUtils";

describe("viewport framing", () => {
  it("moves farther back for a narrow viewport", () => {
    const fov = THREE.MathUtils.degToRad(45);
    expect(frameDistance(10, fov, 0.5)).toBeGreaterThan(
      frameDistance(10, fov, 16 / 9),
    );
  });

  it("preserves textured material data while applying a subtle tint", () => {
    const texture = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({
      color: 0x446688,
      map: texture,
      roughness: 0.37,
    });
    const tinted = tintLockedMaterial(source) as THREE.MeshStandardMaterial;

    expect(tinted).not.toBe(source);
    expect(tinted.map).toBe(texture);
    expect(tinted.roughness).toBe(0.37);
    expect(tinted.color.getHex()).not.toBe(source.color.getHex());
    expect(source.color.getHex()).toBe(0x446688);
  });
});

// Instanced vegetation and rocks: conifers, broadleaf trees, blossom and
// autumn trees, bushes and boulders. One InstancedMesh per kind.
import * as THREE from 'three';
import { Batch, FX, Frame, G } from './kit';

export type TreeKind = 'pine' | 'fir' | 'oak' | 'round' | 'blossom' | 'autumn' | 'bush' | 'rock';

export interface Plant {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  s: number;
  ry: number;
  tint: number; // brightness variation
}

const ico1 = new THREE.IcosahedronGeometry(1, 1);
const lo = new THREE.SphereGeometry(1, 6, 4);
const trunkG = new THREE.CylinderGeometry(0.7, 1, 1, 5, 1, true);

function geoFor(kind: TreeKind): THREE.BufferGeometry {
  const b = new Batch();
  const f = new Frame();
  const trunk = '#5e4130';
  let first = true;
  const blob = (x: number, y: number, z: number, rx: number, ry: number, rz: number, col: string) => {
    b.add(first ? ico1 : lo, col, f.mat(x, y, z, first ? 0 : 0.5, rx, ry, rz), FX.sway);
    first = false;
  };
  switch (kind) {
    case 'pine': {
      // tall conifer: three stacked cones
      b.add(trunkG, trunk, f.mat(0, 0.35, 0, 0, 0.1, 0.7, 0.1));
      b.add(G.cone8, '#2d5634', f.mat(0, 0.95, 0, 0.2, 0.9, 1.2, 0.9), FX.sway);
      b.add(G.cone8, '#346140', f.mat(0, 1.6, 0, 0.6, 0.7, 1.1, 0.7), FX.sway);
      b.add(G.cone8, '#3c6d45', f.mat(0, 2.2, 0, 1.0, 0.45, 1.0, 0.45), FX.sway);
      break;
    }
    case 'fir': {
      // rounder dark conifer (umbrella pine look)
      b.add(trunkG, trunk, f.mat(0, 0.6, 0, 0, 0.1, 1.2, 0.1));
      blob(0, 1.45, 0, 0.95, 0.42, 0.85, '#355f36');
      blob(0.35, 1.9, 0.1, 0.6, 0.3, 0.55, '#3f6c3d');
      blob(-0.3, 1.75, -0.2, 0.55, 0.28, 0.5, '#2f5532');
      break;
    }
    case 'oak': {
      b.add(trunkG, trunk, f.mat(0, 0.45, 0, 0, 0.12, 0.9, 0.12));
      blob(0, 1.35, 0, 0.85, 0.72, 0.85, '#5a8536');
      blob(0.45, 1.15, 0.25, 0.58, 0.5, 0.58, '#668f3c');
      blob(-0.4, 1.2, -0.25, 0.6, 0.52, 0.6, '#4e7a30');
      blob(0.05, 1.8, -0.1, 0.5, 0.42, 0.5, '#72993f');
      break;
    }
    case 'round': {
      b.add(trunkG, trunk, f.mat(0, 0.4, 0, 0, 0.1, 0.8, 0.1));
      blob(0, 1.2, 0, 0.7, 0.75, 0.7, '#6b9442');
      blob(0.25, 1.55, 0.1, 0.42, 0.42, 0.42, '#7aa24a');
      break;
    }
    case 'blossom': {
      b.add(trunkG, '#6b4a3a', f.mat(0, 0.45, 0, 0, 0.1, 0.9, 0.1));
      blob(0, 1.25, 0, 0.8, 0.6, 0.8, '#e7a9b9');
      blob(0.4, 1.1, 0.2, 0.5, 0.42, 0.5, '#f1c3cf');
      blob(-0.35, 1.15, -0.2, 0.5, 0.42, 0.5, '#d98fa3');
      break;
    }
    case 'autumn': {
      b.add(trunkG, trunk, f.mat(0, 0.45, 0, 0, 0.11, 0.9, 0.11));
      blob(0, 1.3, 0, 0.8, 0.66, 0.8, '#d0853a');
      blob(0.42, 1.1, 0.2, 0.52, 0.45, 0.52, '#e0a346');
      blob(-0.38, 1.18, -0.22, 0.52, 0.45, 0.52, '#b9602e');
      break;
    }
    case 'bush': {
      blob(0, 0.28, 0, 0.55, 0.4, 0.5, '#58803a');
      blob(0.35, 0.22, 0.1, 0.35, 0.3, 0.35, '#678f40');
      break;
    }
    case 'rock': {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        const n = 0.78 + 0.3 * Math.abs(Math.sin(x * 4.1 + y * 2.3) * Math.cos(z * 3.7 - y));
        p.setXYZ(i, x * n, Math.max(-0.3, y) * n * 0.75, z * n);
      }
      g.computeVertexNormals();
      b.add(g, '#9a9284', f.mat(0, 0.12, 0));
      g.dispose();
      break;
    }
  }
  const mesh = b.build(new THREE.MeshBasicMaterial())!;
  (mesh.material as THREE.Material).dispose();
  return mesh.geometry;
}

export class Nature {
  group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  constructor(plants: Plant[], mat: THREE.Material, shadows = true) {
    const by = new Map<TreeKind, Plant[]>();
    for (const p of plants) {
      const l = by.get(p.kind);
      if (l) l.push(p);
      else by.set(p.kind, [p]);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [kind, list] of by) {
      const geo = geoFor(kind);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.ry);
        const sy = kind === 'rock' ? p.s * (0.7 + (p.tint - 0.9) * 2) : p.s * (0.9 + (p.tint - 0.85) * 0.8);
        m.compose(v.set(p.x, p.y, p.z), q, s.set(p.s, sy, p.s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, c.setScalar(p.tint));
      });
      im.castShadow = shadows && kind !== 'bush';
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.meshes.push(im);
    }
  }
  dispose() {
    this.meshes.forEach((m) => {
      m.geometry.dispose();
      m.dispose();
    });
  }
}

import { CircleGeometry } from 'three'

/**
 * The eucalyptus leaf and the scatter helpers shared by the two three.js
 * scenes (components/StemCanvas.tsx and components/LeafDrift.tsx).
 */

/** Depth of the leaf's cup, as a fraction of its radius. */
const LEAF_CUP = 0.2

/** Round leaf, gently cupped so the light rolls across it as it turns. */
export function buildLeafGeometry(): CircleGeometry {
  const geometry = new CircleGeometry(1, 28)
  const position = geometry.getAttribute('position')
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const y = position.getY(i)
    position.setZ(i, -LEAF_CUP * (x * x + y * y))
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/** Deterministic scatter, so a scene is identical on every visit. */
export function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/** Wrap a value into [-span / 2, span / 2). */
export function wrap(value: number, span: number): number {
  return ((((value + span / 2) % span) + span) % span) - span / 2
}

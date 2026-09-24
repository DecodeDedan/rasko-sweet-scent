'use client'

import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'

import { buildLeafGeometry, seeded, wrap } from '../lib/leaves'
import { prefersReducedMotion } from '../lib/motion'

/**
 * A Baby Blue stem, built rather than photographed, that the reader moves
 * through by scrolling.
 *
 * WHY THIS AND NOT A DECORATIVE 3D OBJECT
 * The signature of this plant is the rhythm of its leaves: opposite pairs,
 * each a quarter turn from the one below, all the way up the stem. A
 * photograph flattens that into a silhouette. Turning the arrangement is the
 * one thing a 3D view shows that a photograph cannot.
 *
 * WHO DRIVES IT
 * `progress` (0 to 1) is written by the GSAP ScrollTrigger that pins the
 * section (components/StemStudy.tsx). GSAP owns the scroll; this component
 * only reads the number each frame, so the two never fight over timing.
 *
 * COLOUR
 * The leaves take the logo's own sage greens (#70A287, #3E8E59, #1F5C3D),
 * lifted toward the brand tint by the light. That is the one reading of
 * "silver over blue-green" the locked green palette allows.
 */

type Props = {
  className?: string
  progress: MutableRefObject<number>
}

/** Leaf pairs up the stem. Each pair is a quarter turn from the one below. */
const NODE_COUNT = 17
const STEM_HEIGHT = 8
const STEM_RADIUS = 0.07
/** How far a leaf's centre sits from the stem. */
const LEAF_OFFSET = 0.7
const LEAF_RADIUS_BASE = 0.72
const LEAF_RADIUS_TIP = 0.28
/** Loose leaves drifting in the space around the stem. */
const DRIFT_COUNT = 46
const DRIFT_BOX = { x: 7, y: 10, z: 5 } as const
/** Idle rotation in radians per second, on top of what the scroll adds. */
const IDLE_SPIN = 0.12
/** Total turn the stem makes across the pinned scroll. */
const SCROLL_SPIN = Math.PI * 2.25
/** Where the pairs start to loosen from the stem, and how far they travel. */
const LOOSEN_FROM = 0.62
const LOOSEN_DISTANCE = 1.1
/** Wider than this, the canvas fills the section and the stem is framed right of centre. */
const WIDE_FROM = 896
/** Share of the canvas width the view shifts by, so the stem clears the text. */
const WIDE_SHIFT = 0.24
/** Static pose for visitors who asked for reduced motion. */
const REDUCED_PROGRESS = 0.35
/** Fraction of the gap to the pointer target closed each frame. */
const POINTER_EASE = 0.06

const STEM_COLOUR = '#1F5C3D'
const LEAF_COLOURS = ['#70A287', '#3E8E59'] as const
const LEAF_LIFT = '#CFE3CC'

export function StemCanvas({ className, progress }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    // WebGL is absent on some older and locked-down browsers. The canvas stays
    // empty there and the text beside it carries the section alone.
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      return
    }

    const reduced = prefersReducedMotion()
    const random = seeded(7)

    // Retina is enough; uncapped DPR on a 3x phone quadruples fill cost.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' })
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(32, 1, 0.1, 100)

    const stemGroup = new Group()
    stemGroup.rotation.z = MathUtils.degToRad(-7)
    scene.add(stemGroup)

    const stemGeometry = new CylinderGeometry(STEM_RADIUS * 0.55, STEM_RADIUS, STEM_HEIGHT, 12)
    const stemMaterial = new MeshStandardMaterial({ color: STEM_COLOUR, roughness: 0.8 })
    stemGroup.add(new Mesh(stemGeometry, stemMaterial))

    const leafGeometry = buildLeafGeometry()
    // Matt and slightly rough: the real leaf has a powdery bloom, not a shine.
    const leafMaterial = new MeshStandardMaterial({ roughness: 0.62, side: DoubleSide })

    // One InstancedMesh per population keeps the scene at three draw calls.
    const pairLeaves = new InstancedMesh(leafGeometry, leafMaterial, NODE_COUNT * 2)
    stemGroup.add(pairLeaves)
    const driftLeaves = new InstancedMesh(leafGeometry, leafMaterial, DRIFT_COUNT)
    scene.add(driftLeaves)

    const lift = new Color(LEAF_LIFT)
    const tone = (index: number) =>
      new Color(LEAF_COLOURS[index % LEAF_COLOURS.length]).lerp(lift, random() * 0.35)
    for (let i = 0; i < NODE_COUNT * 2; i += 1) pairLeaves.setColorAt(i, tone(i))
    for (let i = 0; i < DRIFT_COUNT; i += 1) driftLeaves.setColorAt(i, tone(i))

    const pairs = Array.from({ length: NODE_COUNT }, (_, node) => {
      const t = node / (NODE_COUNT - 1)
      return {
        y: -STEM_HEIGHT / 2 + t * STEM_HEIGHT,
        angle: node * (Math.PI / 2),
        radius: MathUtils.lerp(LEAF_RADIUS_BASE, LEAF_RADIUS_TIP, t),
        // The tip lets go before the base, the way a stem is stripped.
        release: 0.5 + t * 0.5,
      }
    })

    const drift = Array.from({ length: DRIFT_COUNT }, () => ({
      // Biased right of the stem: on a wide screen the text sits to the left,
      // and a pale leaf passing behind white type would cost it contrast.
      x: -2 + random() * DRIFT_BOX.x * 1.4,
      y: (random() - 0.5) * DRIFT_BOX.y,
      z: -1 - random() * DRIFT_BOX.z,
      spin: 0.2 + random() * 0.6,
      phase: random() * Math.PI * 2,
      rise: 0.08 + random() * 0.18,
      size: 0.18 + random() * 0.3,
    }))

    scene.add(new HemisphereLight(0xffffff, 0x16381a, 2.2))
    const key = new DirectionalLight(0xffffff, 1.9)
    key.position.set(4, 6, 8)
    scene.add(key)
    // A light from behind rims every leaf edge against the dark green ground.
    const rim = new DirectionalLight(0xe9f2e7, 1.4)
    rim.position.set(-5, 2, -6)
    scene.add(rim)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      // A view offset moves the frame, not the scene, so the stem's geometry
      // and the camera path stay the same at every width.
      if (w >= WIDE_FROM) camera.setViewOffset(w, h, -w * WIDE_SHIFT, 0, w, h)
      else camera.clearViewOffset()
      camera.updateProjectionMatrix()
    }
    resize()
    const sizeObserver = new ResizeObserver(resize)
    sizeObserver.observe(host)

    // Pointer parallax, eased toward its target so it never jerks.
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const handlePointer = (event: PointerEvent) => {
      pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1
      pointer.targetY = (event.clientY / window.innerHeight) * 2 - 1
    }
    if (!reduced) window.addEventListener('pointermove', handlePointer, { passive: true })

    const dummy = new Object3D()
    let spin = 0
    let elapsed = 0

    const placePairs = (p: number) => {
      const loosen = MathUtils.smoothstep(p, LOOSEN_FROM, 1)
      pairs.forEach((pair, node) => {
        const away = loosen * pair.release
        for (const side of [0, 1]) {
          const angle = pair.angle + side * Math.PI
          const reach = LEAF_OFFSET + away * LOOSEN_DISTANCE
          dummy.position.set(Math.cos(angle) * reach, pair.y + away * 0.5, Math.sin(angle) * reach)
          dummy.rotation.set(0, -angle, 0)
          dummy.rotateX(MathUtils.degToRad(-72 + away * 50))
          dummy.scale.setScalar(pair.radius)
          dummy.updateMatrix()
          pairLeaves.setMatrixAt(node * 2 + side, dummy.matrix)
        }
      })
      pairLeaves.instanceMatrix.needsUpdate = true
    }

    const placeDrift = (p: number, cameraY: number) => {
      drift.forEach((leaf, i) => {
        // Rise with time and with the scroll, wrapping inside the box.
        const y = wrap(leaf.y + elapsed * leaf.rise + p * 5, DRIFT_BOX.y)
        dummy.position.set(
          leaf.x + Math.sin(elapsed * 0.4 + leaf.phase) * 0.3,
          y + cameraY * 0.6,
          leaf.z,
        )
        dummy.rotation.set(elapsed * leaf.spin + leaf.phase, elapsed * leaf.spin * 0.7, leaf.phase)
        dummy.scale.setScalar(leaf.size)
        dummy.updateMatrix()
        driftLeaves.setMatrixAt(i, dummy.matrix)
      })
      driftLeaves.instanceMatrix.needsUpdate = true
    }

    const render = () => {
      const p = reduced ? REDUCED_PROGRESS : MathUtils.clamp(progress.current, 0, 1)
      pointer.x += (pointer.targetX - pointer.x) * POINTER_EASE
      pointer.y += (pointer.targetY - pointer.y) * POINTER_EASE

      // Travel up the stem, closing in through the middle of the scroll.
      const cameraY = MathUtils.lerp(-2.2, 2.4, p)
      camera.position.set(
        pointer.x * 0.8,
        cameraY - pointer.y * 0.4,
        12.5 - Math.sin(p * Math.PI) * 3.4,
      )
      camera.lookAt(0, cameraY * 0.7, 0)
      stemGroup.rotation.y = spin + p * SCROLL_SPIN

      placePairs(p)
      placeDrift(p, cameraY)
      renderer.render(scene, camera)
    }

    /* The loop runs only while the canvas is on screen: a WebGL context
     * animating out of view is pure battery cost. */
    let frame = 0
    let last = performance.now()
    let running = false

    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05)
      last = now
      elapsed += delta
      spin += delta * IDLE_SPIN
      render()
      frame = requestAnimationFrame(tick)
    }

    const visibility = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry === undefined) return
        if (entry.isIntersecting && !running) {
          running = true
          last = performance.now()
          // Reduced motion still gets the object, as one still frame.
          if (reduced) render()
          else frame = requestAnimationFrame(tick)
        } else if (!entry.isIntersecting && running) {
          running = false
          cancelAnimationFrame(frame)
        }
      },
      { rootMargin: '120px' },
    )
    visibility.observe(host)

    return () => {
      cancelAnimationFrame(frame)
      visibility.disconnect()
      sizeObserver.disconnect()
      window.removeEventListener('pointermove', handlePointer)
      // GPU resources are released by hand; the garbage collector does not
      // reach into the graphics driver.
      stemGeometry.dispose()
      stemMaterial.dispose()
      leafGeometry.dispose()
      leafMaterial.dispose()
      pairLeaves.dispose()
      driftLeaves.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [progress])

  return <div ref={hostRef} className={className} aria-hidden="true" />
}

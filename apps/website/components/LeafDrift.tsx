'use client'

import { useEffect, useRef } from 'react'
import {
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'

import { buildLeafGeometry, seeded, wrap } from '../lib/leaves'
import { prefersReducedMotion } from '../lib/motion'

/**
 * Round eucalyptus leaves falling slowly through the hero, behind the type.
 * "All that nature gives", shown rather than said.
 *
 * CONTRAST
 * The leaves pass behind white text, so they are kept dark and translucent:
 * the lightest possible overlap (#70A287 at 0.35 over #2D6A2F) still leaves
 * white type above 5:1.
 *
 * Driven entirely by three.js; scroll is read once per frame from
 * `window.scrollY` for the parallax, so no GSAP trigger touches this canvas.
 */

type Props = { className?: string }

const LEAF_COUNT = 34
/** The box the leaves fall through, in world units. */
const FIELD = { x: 16, y: 11, z: 6 } as const
/** Fall speed range, world units per second. */
const FALL_MIN = 0.18
const FALL_RANGE = 0.3
/** How far scrolling carries the field upward, world units per pixel. */
const SCROLL_PARALLAX = 0.004
const LEAF_OPACITY = 0.35
const LEAF_COLOURS = ['#70A287', '#3E8E59', '#1F5C3D'] as const
/** Fraction of the gap to the pointer target closed each frame. */
const POINTER_EASE = 0.05

export function LeafDrift({ className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      // No WebGL: the hero reads perfectly well on plain green.
      return
    }

    const reduced = prefersReducedMotion()
    const random = seeded(11)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' })
    host.appendChild(renderer.domElement)

    const scene = new Scene()
    const camera = new PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 0, 12)

    const geometry = buildLeafGeometry()
    const material = new MeshStandardMaterial({
      roughness: 0.6,
      side: DoubleSide,
      transparent: true,
      opacity: LEAF_OPACITY,
      depthWrite: false,
    })
    const leaves = new InstancedMesh(geometry, material, LEAF_COUNT)
    scene.add(leaves)

    const field = Array.from({ length: LEAF_COUNT }, (_, i) => {
      leaves.setColorAt(i, new Color(LEAF_COLOURS[i % LEAF_COLOURS.length]))
      return {
        x: (random() - 0.5) * FIELD.x,
        y: (random() - 0.5) * FIELD.y,
        z: -random() * FIELD.z,
        fall: FALL_MIN + random() * FALL_RANGE,
        sway: 0.4 + random() * 0.8,
        spin: 0.3 + random() * 0.9,
        phase: random() * Math.PI * 2,
        size: 0.25 + random() * 0.45,
      }
    })

    scene.add(new HemisphereLight(0xffffff, 0x16381a, 2))
    const key = new DirectionalLight(0xffffff, 1.6)
    key.position.set(3, 6, 8)
    scene.add(key)

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const sizeObserver = new ResizeObserver(resize)
    sizeObserver.observe(host)

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
    const handlePointer = (event: PointerEvent) => {
      pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1
      pointer.targetY = (event.clientY / window.innerHeight) * 2 - 1
    }
    if (!reduced) window.addEventListener('pointermove', handlePointer, { passive: true })

    const dummy = new Object3D()
    let elapsed = 0

    const render = () => {
      pointer.x += (pointer.targetX - pointer.x) * POINTER_EASE
      pointer.y += (pointer.targetY - pointer.y) * POINTER_EASE
      camera.position.x = pointer.x * 0.9
      camera.position.y = -pointer.y * 0.5
      camera.lookAt(0, 0, -FIELD.z / 2)

      const lift = window.scrollY * SCROLL_PARALLAX
      field.forEach((leaf, i) => {
        const y = wrap(leaf.y - elapsed * leaf.fall + lift, FIELD.y)
        const x = leaf.x + Math.sin(elapsed * leaf.sway + leaf.phase) * 0.6
        dummy.position.set(x, y, leaf.z)
        dummy.rotation.set(
          elapsed * leaf.spin + leaf.phase,
          Math.sin(elapsed * leaf.sway + leaf.phase) * 1.2,
          leaf.phase,
        )
        dummy.scale.setScalar(leaf.size)
        dummy.updateMatrix()
        leaves.setMatrixAt(i, dummy.matrix)
      })
      leaves.instanceMatrix.needsUpdate = true
      renderer.render(scene, camera)
    }

    let frame = 0
    let last = performance.now()
    let running = false
    const tick = (now: number) => {
      elapsed += Math.min((now - last) / 1000, 0.05)
      last = now
      render()
      frame = requestAnimationFrame(tick)
    }

    // Only animate while the hero is on screen.
    const visibility = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry === undefined) return
      if (entry.isIntersecting && !running) {
        running = true
        last = performance.now()
        if (reduced) render()
        else frame = requestAnimationFrame(tick)
      } else if (!entry.isIntersecting && running) {
        running = false
        cancelAnimationFrame(frame)
      }
    })
    visibility.observe(host)

    return () => {
      cancelAnimationFrame(frame)
      visibility.disconnect()
      sizeObserver.disconnect()
      window.removeEventListener('pointermove', handlePointer)
      geometry.dispose()
      material.dispose()
      leaves.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={hostRef} className={className} aria-hidden="true" />
}

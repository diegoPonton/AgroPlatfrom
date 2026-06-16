'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function AgroScene() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ── Renderer ──────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    mount.appendChild(renderer.domElement)

    // ── Scene & Camera ────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x0a1f0e, 0.045)

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 200)
    camera.position.set(0, 6, 18)
    camera.lookAt(0, 0, 0)

    // ── Lighting ──────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x112211, 1.2))
    const moon = new THREE.DirectionalLight(0x8ab4f8, 0.8)
    moon.position.set(10, 20, 10)
    scene.add(moon)

    // ── Stars ─────────────────────────────────────────────────────────────────
    const starPositions = new Float32Array(2000 * 3)
    for (let i = 0; i < starPositions.length; i++) {
      starPositions[i] = (Math.random() - 0.5) * 200
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, sizeAttenuation: true })
    scene.add(new THREE.Points(starGeo, starMat))

    // ── Terrain ───────────────────────────────────────────────────────────────
    const terrainGeo = new THREE.PlaneGeometry(60, 60, 80, 80)
    const pos = terrainGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z =
        Math.sin(x * 0.15) * Math.cos(y * 0.15) * 1.8 +
        Math.sin(x * 0.35 + 1) * 0.6 +
        Math.cos(y * 0.25 + 2) * 0.4
      pos.setZ(i, z)
    }
    terrainGeo.computeVertexNormals()
    terrainGeo.rotateX(-Math.PI / 2)

    const terrainMat = new THREE.MeshLambertMaterial({ color: 0x1a3d1a, wireframe: false })
    const terrain = new THREE.Mesh(terrainGeo, terrainMat)
    terrain.receiveShadow = true
    terrain.position.y = -2
    scene.add(terrain)

    // Grid overlay on terrain
    const gridHelper = new THREE.GridHelper(60, 30, 0x2d5a2d, 0x1e3d1e)
    gridHelper.position.y = -1.98
    gridHelper.material.opacity = 0.25
    gridHelper.material.transparent = true
    scene.add(gridHelper)

    // ── Sensor Nodes (ESP32) ──────────────────────────────────────────────────
    const NODE_POSITIONS: [number, number, number][] = [
      [-6, -0.5, -4], [4, 0.2, -6], [-3, 0.4, 2],
      [7, -0.3, 1], [0, 0.6, -2], [-8, 0.1, -1],
    ]

    const nodeGroup = new THREE.Group()
    scene.add(nodeGroup)

    const nodeMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff44,
      emissiveIntensity: 0.8,
      roughness: 0.3,
      metalness: 0.6,
    })

    NODE_POSITIONS.forEach(([x, y, z]) => {
      // PCB base
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.35), new THREE.MeshStandardMaterial({ color: 0x1a4a1a, roughness: 0.5, metalness: 0.4 }))
      base.position.set(x, y, z)
      nodeGroup.add(base)

      // ESP32 chip
      const chip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.22), nodeMat)
      chip.position.set(x, y + 0.07, z)
      nodeGroup.add(chip)

      // Antenna
      const antGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.4, 6)
      const ant = new THREE.Mesh(antGeo, new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9 }))
      ant.position.set(x + 0.22, y + 0.22, z)
      nodeGroup.add(ant)

      // Glow point light
      const light = new THREE.PointLight(0x00ff88, 0.6, 3)
      light.position.set(x, y + 0.2, z)
      nodeGroup.add(light)
    })

    // ── Gateway (Receptor) ────────────────────────────────────────────────────
    const gatewayMat = new THREE.MeshStandardMaterial({ color: 0x0088ff, emissive: 0x0044ff, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.7 })
    const gateway = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.55), new THREE.MeshStandardMaterial({ color: 0x003366, roughness: 0.4, metalness: 0.5 }))
    gateway.position.set(0, 0.7, -2)
    scene.add(gateway)

    const gwChip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.3), gatewayMat)
    gwChip.position.set(0, 0.77, -2)
    scene.add(gwChip)

    // Gateway tower
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8), new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.8 }))
    tower.position.set(0, 1.95, -2)
    scene.add(tower)

    const gwLight = new THREE.PointLight(0x0088ff, 1.5, 8)
    gwLight.position.set(0, 3.5, -2)
    scene.add(gwLight)

    // ── LoRa Radio Waves ──────────────────────────────────────────────────────
    type Wave = { mesh: THREE.Mesh; node: [number, number, number]; scale: number; life: number; maxLife: number }
    const waves: Wave[] = []

    function spawnWave(nodePos: [number, number, number], isGateway = false) {
      const geo = new THREE.RingGeometry(0.05, 0.12, 32)
      const mat = new THREE.MeshBasicMaterial({
        color: isGateway ? 0x0088ff : 0x00ff88,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      })
      const ring = new THREE.Mesh(geo, mat)
      ring.rotation.x = -Math.PI / 2
      ring.position.set(nodePos[0], nodePos[1] + 0.3, nodePos[2])
      scene.add(ring)
      waves.push({ mesh: ring, node: nodePos, scale: 0.1, life: 0, maxLife: 2.5 })
    }

    // ── Data Packets (flying particles) ───────────────────────────────────────
    type Packet = { mesh: THREE.Mesh; progress: number; from: [number, number, number]; speed: number }
    const packets: Packet[] = []
    const gatewayPos: [number, number, number] = [0, 1.5, -2]

    function spawnPacket(from: [number, number, number]) {
      const geo = new THREE.SphereGeometry(0.06, 6, 6)
      const mat = new THREE.MeshBasicMaterial({ color: 0x00ffaa })
      const mesh = new THREE.Mesh(geo, mat)
      const trail = new THREE.PointLight(0x00ffaa, 0.4, 1.5)
      mesh.add(trail)
      mesh.position.set(...from)
      scene.add(mesh)
      packets.push({ mesh, progress: 0, from, speed: 0.3 + Math.random() * 0.2 })
    }

    // ── Floating crop icons (simple geometries suggesting plants) ─────────────
    const cropPositions: [number, number, number][] = [
      [-5, -1.8, 3], [-2, -1.8, 5], [3, -1.8, 4], [6, -1.8, -3], [-7, -1.8, -5],
    ]
    cropPositions.forEach(([x, y, z]) => {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), new THREE.MeshLambertMaterial({ color: 0x2d7a2d }))
      stem.position.set(x, y + 0.3, z)
      scene.add(stem)
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshLambertMaterial({ color: 0x3aaa3a }))
      leaf.position.set(x, y + 0.75, z)
      leaf.scale.set(1, 0.4, 1)
      scene.add(leaf)
    })

    // ── Animation state ───────────────────────────────────────────────────────
    let frameId: number
    let elapsed = 0
    let waveTimer = 0
    let packetTimer = 0
    let waveNodeIdx = 0

    const clock = new THREE.Clock()

    function animate() {
      frameId = requestAnimationFrame(animate)
      const dt = clock.getDelta()
      elapsed += dt
      waveTimer += dt
      packetTimer += dt

      // Slow camera orbit
      camera.position.x = Math.sin(elapsed * 0.06) * 20
      camera.position.z = Math.cos(elapsed * 0.06) * 20
      camera.position.y = 5 + Math.sin(elapsed * 0.08) * 1.5
      camera.lookAt(0, 0.5, 0)

      // Pulse node lights
      nodeGroup.children.forEach((child, i) => {
        if (child instanceof THREE.PointLight) {
          child.intensity = 0.4 + Math.sin(elapsed * 2 + i) * 0.25
        }
      })

      // Gateway pulsing
      gwLight.intensity = 1.2 + Math.sin(elapsed * 3) * 0.6

      // Spawn radio waves every 0.8s
      if (waveTimer > 0.8) {
        waveTimer = 0
        const nodePos = NODE_POSITIONS[waveNodeIdx % NODE_POSITIONS.length]
        spawnWave(nodePos)
        if (waveNodeIdx % 3 === 0) spawnWave(gatewayPos, true)
        waveNodeIdx++
      }

      // Animate radio waves
      for (let i = waves.length - 1; i >= 0; i--) {
        const w = waves[i]
        w.life += dt
        w.scale += dt * 3.5
        w.mesh.scale.setScalar(w.scale)
        const mat = w.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = Math.max(0, 0.8 * (1 - w.life / w.maxLife))
        if (w.life >= w.maxLife) {
          scene.remove(w.mesh)
          w.mesh.geometry.dispose()
          waves.splice(i, 1)
        }
      }

      // Spawn data packets every 1.8s
      if (packetTimer > 1.8) {
        packetTimer = 0
        const from = NODE_POSITIONS[Math.floor(Math.random() * NODE_POSITIONS.length)]
        spawnPacket([from[0], from[1] + 0.5, from[2]])
      }

      // Animate packets toward gateway
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]
        p.progress = Math.min(1, p.progress + dt * p.speed)
        const t = p.progress

        // Bezier arc toward gateway
        const cx = (p.from[0] + gatewayPos[0]) / 2
        const cy = 4
        const cz = (p.from[2] + gatewayPos[2]) / 2

        p.mesh.position.x = (1 - t) * (1 - t) * p.from[0] + 2 * (1 - t) * t * cx + t * t * gatewayPos[0]
        p.mesh.position.y = (1 - t) * (1 - t) * p.from[1] + 2 * (1 - t) * t * cy + t * t * gatewayPos[1]
        p.mesh.position.z = (1 - t) * (1 - t) * p.from[2] + 2 * (1 - t) * t * cz + t * t * gatewayPos[2]

        const mat = p.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = t < 0.9 ? 1 : 1 - (t - 0.9) / 0.1

        if (p.progress >= 1) {
          scene.remove(p.mesh)
          packets.splice(i, 1)
        }
      }

      renderer.render(scene, camera)
    }

    animate()

    // ── Resize handler ────────────────────────────────────────────────────────
    const onResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={mountRef} className="absolute inset-0 w-full h-full" />
}

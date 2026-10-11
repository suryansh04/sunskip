import * as THREE from 'three'
import { DeviceOrientationControls, LocAR, Webcam } from 'locar'
import type { DeviceOrientationErrorEvent, WebcamErrorEvent, WebcamStartedEvent } from 'locar'
import {
  CAMERA_FAR_M,
  CAMERA_LONG_SIDE_FOV_DEG,
  CAMERA_NEAR_M,
  MAX_PIXEL_RATIO,
  ORIENTATION_SMOOTHING_FACTOR,
  POSITION_GLIDE_S,
  POSITION_JUMP_M,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from './config.ts'
import { createLocalProjection, normalizeDeg } from './geo.ts'
import type { LatLng } from './geo.ts'

export type CameraFeedState = 'off' | 'starting' | 'running' | 'denied' | 'error'
export type MotionState = 'off' | 'needs-tap' | 'starting' | 'running' | 'denied' | 'unsupported'

export interface DeskCamera {
  headingDeg: number
  pitchDeg: number
}

export interface ArStageOptions {
  /** Desk mode: no webcam or motion sensors, the camera is fixed at this heading. */
  desk?: DeskCamera
  onCameraFeed?: (state: CameraFeedState) => void
  onMotion?: (state: MotionState) => void
}

/**
 * The camera feed, three.js renderer and LocAR wiring, with no React in it.
 * World axes: +x east, -z north, y = 0 at eye level, 1 unit = 1 metre.
 */
export interface ArStage {
  /** Parent for everything anchored to the ground. */
  readonly world: THREE.Group
  readonly camera: THREE.PerspectiveCamera
  /**
   * Move the viewer. The first call fixes the world origin; after that the camera glides to each
   * new point, and only jumps there when it is far away.
   */
  setPosition(point: LatLng): void
  /** World x/z of a point, or null until the first setPosition. */
  toWorld(point: LatLng): { x: number; z: number } | null
  /**
   * Heading the camera looks along, degrees clockwise from north, with the heading offset
   * applied. When the phone is tilted nearly flat this is where its top edge points.
   */
  getFacingDeg(): number
  /** The same heading straight from the sensors, without the heading offset. */
  getCompassDeg(): number
  /**
   * Correct a compass that reads wrong: the true heading is taken to be the sensor heading plus
   * this many degrees. Done by turning `world` about the viewer.
   */
  setHeadingOffset(offsetDeg: number): void
  /** Desk mode only: turn the fixed camera to a new heading. */
  setDeskHeading(headingDeg: number): void
  /** Size of the camera feed, or null if it isn't running. */
  getVideoSize(): { width: number; height: number } | null
  /** Run a callback before each rendered frame. Returns a function that removes it. */
  onFrame(callback: (dtSeconds: number) => void): () => void
  /** Call from a tap handler when onMotion reports 'needs-tap' (iOS). */
  requestMotionPermission(): void
  /** Draw calls in the last rendered frame, for the debug readout. */
  getDrawCalls(): number
  /** Stop rendering, the camera and the motion sensors (page in the background). */
  pause(): void
  /** Undo pause(): the camera is requested again. */
  resume(): void
  /** Stop everything for good and free the GPU resources the stage itself owns. */
  dispose(): void
}

/**
 * True where motion sensors sit behind DeviceOrientationEvent.requestPermission(). iOS only
 * grants it from a tap; Chrome has the same function but grants it straight away.
 */
function hasMotionPermissionApi(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    // requestPermission is an iOS-only static that lib.dom.d.ts doesn't declare
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
      .requestPermission === 'function'
  )
}

/** Vertical field of view of what an `object-fit: cover` video shows in a viewW x viewH box. */
function coverVerticalFovDeg(
  videoW: number,
  videoH: number,
  viewW: number,
  viewH: number,
): number {
  const focalPx =
    Math.max(videoW, videoH) / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA_LONG_SIDE_FOV_DEG) / 2)
  const scale = Math.max(viewW / videoW, viewH / videoH)
  const visibleVideoH = viewH / scale
  return THREE.MathUtils.radToDeg(2 * Math.atan(visibleVideoH / 2 / focalPx))
}

/** Vertical component of the view direction beyond which the phone counts as lying flat. */
const FLAT_TILT = 0.8

const MAX_FRAME_S = 0.25

let videoElementCount = 0

export function createArStage(container: HTMLElement, options: ArStageOptions = {}): ArStage {
  let disposed = false

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, 1, CAMERA_NEAR_M, CAMERA_FAR_M)
  const world = new THREE.Group()
  scene.add(world)

  // We never call locar.startGps(): positions come in through setPosition() -> fakeGps().
  const locar = new LocAR(scene, camera, {}, null, createLocalProjection())
  let hasPosition = false

  // --- Heading ------------------------------------------------------------------------------
  let headingOffsetDeg = 0
  const facing = new THREE.Vector3()

  /** Turn `world` by the heading offset, pivoting on the camera so nearby content stays put. */
  const applyHeadingOffset = () => {
    const angle = THREE.MathUtils.degToRad(headingOffsetDeg)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const { x, z } = camera.position
    world.rotation.y = angle
    world.position.set(x - (x * cos + z * sin), 0, z - (z * cos - x * sin))
  }

  const compassDeg = () => {
    camera.getWorldDirection(facing)
    if (Math.abs(facing.y) > FLAT_TILT) {
      // Looking almost straight down (or up): the view direction has no usable compass
      // heading, but the phone's top edge does.
      const lookingDown = facing.y < 0
      facing.set(0, 1, 0).applyQuaternion(camera.quaternion)
      if (!lookingDown) facing.negate()
    }
    return normalizeDeg(THREE.MathUtils.radToDeg(Math.atan2(facing.x, -facing.z)))
  }

  // --- Position ------------------------------------------------------------------------------
  /** World x/z the camera is gliding to, or null when it is there. */
  let glideTo: { x: number; z: number } | null = null

  const glideCamera = (dtSeconds: number) => {
    if (!glideTo) return
    const blend = 1 - Math.exp(-dtSeconds / POSITION_GLIDE_S)
    camera.position.x += (glideTo.x - camera.position.x) * blend
    camera.position.z += (glideTo.z - camera.position.z) * blend
    if (Math.hypot(glideTo.x - camera.position.x, glideTo.z - camera.position.z) < 0.01) {
      camera.position.x = glideTo.x
      camera.position.z = glideTo.z
      glideTo = null
    }
    applyHeadingOffset()
  }

  // --- Camera feed -------------------------------------------------------------------------
  /** Turns the running (or still starting) camera off. Null while there is none. */
  let stopCamera: (() => void) | null = null
  let videoSize: { width: number; height: number } | null = null

  const updateProjection = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    if (videoSize) {
      camera.fov = coverVerticalFovDeg(videoSize.width, videoSize.height, width, height)
    } else if (width >= height) {
      camera.fov = coverVerticalFovDeg(VIDEO_WIDTH, VIDEO_HEIGHT, width, height)
    } else {
      camera.fov = coverVerticalFovDeg(VIDEO_HEIGHT, VIDEO_WIDTH, width, height)
    }
    camera.updateProjectionMatrix()
  }

  const startCamera = () => {
    // Not `navigator.mediaDevices?.`: the DOM types claim it always exists, but on plain http
    // it is undefined.
    if (!('mediaDevices' in navigator)) {
      // No camera API (plain http, or a very old browser).
      queueMicrotask(() => {
        if (!disposed) options.onCameraFeed?.('error')
      })
      return
    }

    // Our own <video>, behind the canvas (LocAR would otherwise append one to <body>).
    const video = document.createElement('video')
    video.id = `sunskip-ar-video-${++videoElementCount}`
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;'
    // The feed's size flips when the phone rotates.
    const onVideoResize = () => {
      if (stopped || video.videoWidth === 0) return
      videoSize = { width: video.videoWidth, height: video.videoHeight }
      updateProjection()
    }
    video.addEventListener('resize', onVideoResize)
    container.prepend(video)

    const constraints = {
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: VIDEO_WIDTH },
        height: { ideal: VIDEO_HEIGHT },
      },
    }
    const feed = new Webcam(constraints, `#${video.id}`)
    /** The camera request has been answered, one way or the other. */
    let settled = false
    let stopped = false
    feed.on('webcamstarted', (event: WebcamStartedEvent) => {
      settled = true
      if (stopped) {
        // Stopped while the permission prompt was open: the stream only exists now.
        feed.dispose()
        return
      }
      videoSize = { width: event.videoWidth, height: event.videoHeight }
      updateProjection()
      options.onCameraFeed?.('running')
    })
    feed.on('webcamerror', (event: WebcamErrorEvent) => {
      settled = true
      if (stopped) {
        feed.dispose()
        return
      }
      const denied = event.code === 'NotAllowedError' || event.code === 'SecurityError'
      options.onCameraFeed?.(denied ? 'denied' : 'error')
    })

    stopCamera = () => {
      stopped = true
      stopCamera = null
      videoSize = null
      video.removeEventListener('resize', onVideoResize)
      if (settled) {
        feed.dispose() // stops the tracks and removes the <video>
      } else {
        // Webcam.dispose() can't cancel a pending camera request, and would lose track of the
        // stream it later resolves with. The handlers above dispose of it when it arrives.
        video.remove()
      }
    }
  }

  container.appendChild(canvas)
  if (!options.desk) startCamera()

  // --- Orientation -------------------------------------------------------------------------
  let paused = false
  let motionGranted = false
  let controls: DeviceOrientationControls | null = null
  if (options.desk) {
    camera.rotation.set(
      THREE.MathUtils.degToRad(options.desk.pitchDeg),
      -THREE.MathUtils.degToRad(options.desk.headingDeg),
      0,
      'YXZ',
    )
  } else {
    // enablePermissionDialog false: LocAR's own iOS dialog is never removed from <body>, so the
    // page shows its own button and calls requestMotionPermission() instead.
    const orientation = new DeviceOrientationControls(camera, {
      smoothingFactor: ORIENTATION_SMOOTHING_FACTOR,
      enablePermissionDialog: false,
    })
    controls = orientation
    // The first permission request is made without a tap. Chrome grants it; iOS refuses, and
    // then the page has to ask again from a tap.
    let untappedAttempt = hasMotionPermissionApi()
    orientation.on('deviceorientationgranted', () => {
      if (disposed) return
      untappedAttempt = false
      motionGranted = true
      if (!paused) orientation.connect()
      options.onMotion?.('running')
    })
    orientation.on('deviceorientationerror', (event: DeviceOrientationErrorEvent) => {
      if (disposed) return
      if (untappedAttempt) {
        untappedAttempt = false
        options.onMotion?.('needs-tap')
        return
      }
      const denied = event.code === 'LOCAR_DEVICE_ORIENTATION_PERMISSION_DENIED'
      options.onMotion?.(denied ? 'denied' : 'unsupported')
    })
    if (untappedAttempt) orientation.requestOrientationPermissions()
    else orientation.init()
  }

  // --- Render loop -------------------------------------------------------------------------
  const frameCallbacks = new Set<(dtSeconds: number) => void>()
  let lastFrameMs: number | null = null

  const resizeObserver = new ResizeObserver(updateProjection)
  resizeObserver.observe(container)
  updateProjection()

  const renderFrame = (timeMs: number) => {
    // Capped so animations don't leap after a stall.
    const dtSeconds =
      lastFrameMs === null ? 0 : Math.min((timeMs - lastFrameMs) / 1000, MAX_FRAME_S)
    lastFrameMs = timeMs
    controls?.update()
    glideCamera(dtSeconds)
    frameCallbacks.forEach((callback) => callback(dtSeconds))
    renderer.render(scene, camera)
  }
  renderer.setAnimationLoop(renderFrame)

  return {
    world,
    camera,
    setPosition(point) {
      if (!hasPosition) {
        locar.fakeGps(point.lng, point.lat)
        hasPosition = true
        applyHeadingOffset()
        return
      }
      const [x, z] = locar.lonLatToWorldCoords(point.lng, point.lat)
      glideTo = { x, z }
      if (Math.hypot(x - camera.position.x, z - camera.position.z) > POSITION_JUMP_M) {
        camera.position.x = x
        camera.position.z = z
        glideTo = null
        applyHeadingOffset()
      }
    },
    toWorld(point) {
      if (!hasPosition) return null
      const [x, z] = locar.lonLatToWorldCoords(point.lng, point.lat)
      return { x, z }
    },
    getFacingDeg() {
      return normalizeDeg(compassDeg() + headingOffsetDeg)
    },
    getCompassDeg: compassDeg,
    setHeadingOffset(offsetDeg) {
      headingOffsetDeg = offsetDeg
      applyHeadingOffset()
    },
    setDeskHeading(headingDeg) {
      if (options.desk) camera.rotation.y = -THREE.MathUtils.degToRad(headingDeg)
    },
    getVideoSize() {
      return videoSize
    },
    onFrame(callback) {
      frameCallbacks.add(callback)
      return () => frameCallbacks.delete(callback)
    },
    requestMotionPermission() {
      if (disposed || !controls) return
      options.onMotion?.('starting')
      controls.requestOrientationPermissions()
    },
    getDrawCalls() {
      return renderer.info.render.calls
    },
    pause() {
      if (disposed || paused) return
      paused = true
      renderer.setAnimationLoop(null)
      controls?.disconnect()
      stopCamera?.()
    },
    resume() {
      if (disposed || !paused) return
      paused = false
      lastFrameMs = null
      if (!options.desk) startCamera()
      if (motionGranted) controls?.connect()
      renderer.setAnimationLoop(renderFrame)
    },
    dispose() {
      if (disposed) return
      disposed = true
      renderer.setAnimationLoop(null)
      resizeObserver.disconnect()
      frameCallbacks.clear()
      controls?.dispose()
      stopCamera?.()
      renderer.dispose()
      // Browsers cap the number of live WebGL contexts; give this one back straight away.
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}

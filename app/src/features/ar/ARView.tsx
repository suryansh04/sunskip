import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import BottomSheet from './BottomSheet.tsx'
import type { SheetMessage } from './BottomSheet.tsx'
import {
  ALIGN_CONFIRM_DEG,
  ARRIVE_WITHIN_M,
  COLOR_SHADE,
  COLOR_SUN,
  COLOR_UNKNOWN,
  COMPASS_LOOKAHEAD_M,
  GPS_GATE_ACCURACY_M,
  GPS_GATE_EXIT_ACCURACY_M,
  GPS_GATE_EXIT_SECONDS,
  GPS_GATE_SECONDS,
  GPS_GOOD_ACCURACY_M,
  PIN_VISIBLE_WITHIN_M,
  POSITION_GLIDE_S,
  POSITION_JUMP_M,
  REALIGN_PROMPT_CLEAR_M,
  SNAP_MAX_OFFSET_M,
  START_LABEL_AHEAD_M,
  START_LABEL_UNTIL_M,
  STRETCH_LABEL_MAX_AHEAD_M,
  STRETCH_LABEL_MIN_AHEAD_M,
  TURN_MIN_DEG,
  TURN_SOON_M,
  VIBRATE_TURN_MS,
  WALK_SPEED_M_PER_MIN,
} from './config.ts'
import { createConveyor } from './conveyor.ts'
import type { PathPoint } from './conveyor.ts'
import { bearingDeg, deltaDeg, destinationPoint, distanceM } from './geo.ts'
import type { LatLng } from './geo.ts'
import { createFixSmoother, watchGps } from './gps.ts'
import InstructionCard from './InstructionCard.tsx'
import type { CardInfo } from './InstructionCard.tsx'
import { createDestinationPin } from './pin.ts'
import {
  bearingAt,
  buildRoute,
  nextTurn,
  pointAt,
  snapToRoute,
  sunMetresAhead,
} from './route.ts'
import type { Route, Stretch } from './route.ts'
import { createArStage } from './stage.ts'
import type { CameraFeedState, MotionState } from './stage.ts'
import { compassWord } from './status.ts'
import type { GpsStatus } from './status.ts'
import { createStretchLabel } from './stretchLabel.ts'
import type { Waypoint } from './types.ts'

/** How often the instruction card and the debug readout are refreshed. */
const UI_REFRESH_S = 0.25
/** Desk mode's fake fix sits this far to the side of the route, so snapping has work to do. */
const DESK_SIDE_OFFSET_M = 3
/** The heading offset is kept for the browser tab's lifetime: a reload shouldn't lose it. */
const HEADING_OFFSET_KEY = 'sunskip.ar.headingOffsetDeg'

/** Live numbers for a debug overlay. */
export interface ArDebugInfo {
  /** Where the camera is: on the route when snapped, otherwise the smoothed fix. */
  position: LatLng | null
  progressM: number
  routeLengthM: number
  /** Distance of the last fix from the route. */
  offRouteM: number
  snapped: boolean
  accuracyM: number | null
  fixCount: number
  /** Heading with the align offset applied. */
  facingDeg: number
  /** Heading straight from the sensors. */
  compassDeg: number
  headingOffsetDeg: number
  routeBearingDeg: number
  /** True while GPS is too poor for 3D arrows and the 2D compass arrow is showing. */
  gated: boolean
  fps: number
  /** Draw calls in the last frame. */
  drawCalls: number
}

export interface ARViewProps {
  /**
   * The route to walk. A new array with the same waypoints changes nothing; different waypoints
   * (a reroute, the next walk) are drawn in place, without restarting the camera.
   */
  waypoints: readonly Waypoint[]
  /** Desk mode: no camera or sensors, a slider moves a fake position along the route. */
  desk?: boolean
  /** The "Map" tab in the bottom sheet. Without it the tab can't be tapped. */
  onSwitchToMap?: () => void
  /** The close (X) button in the bottom sheet. Without it the button is not shown. */
  onClose?: () => void
  /**
   * The host's 2D arrow screen. With it the sheet shows "Use arrow" ('chosen'), and the walker is
   * sent there by itself when the camera or a permission fails ('unavailable').
   */
  onUseArrow?: (reason: 'chosen' | 'unavailable') => void
  /** Extra controls the host page wants just above the bottom sheet. */
  accessory?: ReactNode
  onDebug?: (info: ArDebugInfo) => void
}

interface ViewActions {
  requestMotionPermission(): void
  /** The walker is pointing the phone along the path: make the compass agree. */
  align(): void
  /** Apply an offset the walker has confirmed. */
  confirmAlign(offsetDeg: number): void
  resetAlign(): void
  /** Draw a different route on the stage that is already running. */
  setRoute(route: Route): void
}

/** Something that stops AR from running, and the one thing the walker can do about it. */
interface Blocker {
  title: string
  body: string
  action?: 'reload' | 'enable-motion'
}

function colorOf(inSun: boolean | null): number {
  if (inSun === null) return COLOR_UNKNOWN
  return inSun ? COLOR_SUN : COLOR_SHADE
}

function readStoredHeadingOffset(): number {
  try {
    const stored = Number(sessionStorage.getItem(HEADING_OFFSET_KEY))
    return Number.isFinite(stored) ? stored : 0
  } catch {
    return 0
  }
}

function storeHeadingOffset(offsetDeg: number): void {
  try {
    sessionStorage.setItem(HEADING_OFFSET_KEY, String(offsetDeg))
  } catch {
    // Storage blocked (private mode): the alignment just won't survive a reload.
  }
}

function vibrate(ms: number): void {
  // Android only; Safari has no vibration API.
  if ('vibrate' in navigator) navigator.vibrate(ms)
}

/** ['camera', 'location'] -> "camera and location" */
function listOf(items: readonly string[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** 7 -> "7 m", 43 -> "45 m", 268 -> "270 m", 1840 -> "1.8 km" */
function formatMetres(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  const step = metres >= 100 ? 10 : metres >= 20 ? 5 : 1
  return `${Math.max(Math.round(metres / step) * step, 1)} m`
}

/** "Sun · 620 m", "Shade · 120 m", "No shade data" */
function stretchText(stretch: Stretch): string {
  if (stretch.inSun === null) return 'No shade data'
  const length = formatMetres(stretch.endM - stretch.startM)
  return stretch.inSun ? `Sun · ${length}` : `Shade · ${length}`
}

/** The stretch the on-path pill marks, and where along the route the pill stands. */
function labelledStretch(route: Route, progressM: number): { stretch: Stretch; atM: number } | null {
  const next = route.stretches.find(
    (stretch) =>
      stretch.startM >= progressM + STRETCH_LABEL_MIN_AHEAD_M &&
      stretch.startM <= progressM + STRETCH_LABEL_MAX_AHEAD_M,
  )
  if (next) return { stretch: next, atM: next.startM }
  // At the start the first stretch began under the walker's feet: show it a little ahead.
  const first = route.stretches[0]
  if (progressM < START_LABEL_UNTIL_M && first) {
    return { stretch: first, atM: Math.min(progressM + START_LABEL_AHEAD_M, first.endM) }
  }
  return null
}

function cardInfoFor(
  route: Route,
  progressM: number,
  accuracyM: number | null,
  desk: boolean,
): CardInfo {
  const sunMinutes = sunMetresAhead(route, progressM) / WALK_SPEED_M_PER_MIN
  const sun =
    sunMinutes < 0.05
      ? 'no sun ahead'
      : sunMinutes < 0.5
        ? '<1 min sun'
        : `${Math.round(sunMinutes)} min sun`
  const gps =
    desk || (accuracyM !== null && accuracyM <= GPS_GOOD_ACCURACY_M)
      ? 'good'
      : accuracyM !== null && accuracyM <= GPS_GATE_ACCURACY_M
        ? 'fair'
        : 'poor'

  const remainingM = route.lengthM - progressM
  if (remainingM <= ARRIVE_WITHIN_M) {
    return { icon: 'arrived', title: 'You have arrived', subtitle: '', sun: null, gps }
  }
  const heading = compassWord(bearingAt(route, progressM))
  const turn = nextTurn(route, progressM, TURN_MIN_DEG)
  if (turn) {
    const side = turn.turnDeg > 0 ? 'right' : 'left'
    if (turn.aheadM <= TURN_SOON_M) {
      const after = compassWord(route.waypoints[turn.index].bearingDeg)
      return {
        icon: side,
        title: `Turn ${side} · ${formatMetres(turn.aheadM)}`,
        subtitle: `then continue ${after}`,
        sun,
        gps,
      }
    }
    return {
      icon: 'straight',
      title: `Continue ${heading} · ${formatMetres(turn.aheadM)}`,
      subtitle: `then turn ${side}`,
      sun,
      gps,
    }
  }
  return {
    icon: 'straight',
    title: `Continue ${heading} · ${formatMetres(remainingM)}`,
    subtitle: 'then arrive',
    sun,
    gps,
  }
}

function sameCard(a: CardInfo, b: CardInfo): boolean {
  return (
    a.icon === b.icon &&
    a.title === b.title &&
    a.subtitle === b.subtitle &&
    a.sun === b.sun &&
    a.gps === b.gps
  )
}

export default function ARView({
  waypoints,
  desk = false,
  onSwitchToMap,
  onClose,
  onUseArrow,
  accessory,
  onDebug,
}: ARViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const compassArrowRef = useRef<HTMLDivElement>(null)
  const moveDeskRef = useRef<((progressM: number) => void) | null>(null)
  const actionsRef = useRef<ViewActions | null>(null)

  // The host may pass a new array on every render (each GPS fix): only different waypoints are a new route.
  const routeKey = waypoints
    .map((waypoint) => `${waypoint.location.lat},${waypoint.location.lng},${waypoint.inSun}`)
    .join(';')
  const route = useMemo(() => buildRoute(waypoints), [routeKey])
  const hasRoute = route !== null
  const latestRoute = useRef(route)

  const [deskProgressM, setDeskProgressM] = useState(0)
  const [gps, setGps] = useState<GpsStatus>(desk ? 'ok' : 'waiting')
  const [cameraFeed, setCameraFeed] = useState<CameraFeedState>(desk ? 'off' : 'starting')
  const [motion, setMotion] = useState<MotionState>(desk ? 'off' : 'starting')
  const [gated, setGated] = useState(false)
  const [realign, setRealign] = useState(false)
  const [headingOffsetDeg, setHeadingOffsetDeg] = useState(() =>
    desk ? 0 : readStoredHeadingOffset(),
  )
  /** An align offset big enough that the walker is asked to confirm it first. */
  const [pendingAlignDeg, setPendingAlignDeg] = useState<number | null>(null)
  const [card, setCard] = useState<CardInfo | null>(() =>
    route ? cardInfoFor(route, 0, null, desk) : null,
  )

  const reportDebug = useEffectEvent((info: ArDebugInfo) => onDebug?.(info))

  // A different route goes to the running stage. (On mount there is no stage yet: it reads latestRoute.)
  useEffect(() => {
    latestRoute.current = route
    if (route) actionsRef.current?.setRoute(route)
  }, [route])

  // The stage (renderer, camera feed, motion sensors, GPS watch) is built once per mount. Rebuilding
  // it restarts the camera and loses the world origin, which shows as flicker and stray arrows.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !latestRoute.current) return
    // Shadows the prop on purpose: this is the route being drawn, replaced by setRoute() below.
    let route: Route = latestRoute.current

    const stage = createArStage(host, {
      desk: desk ? { headingDeg: bearingAt(route, 0), pitchDeg: 0 } : undefined,
      onCameraFeed: setCameraFeed,
      onMotion: setMotion,
    })
    let offsetDeg = desk ? 0 : readStoredHeadingOffset()
    stage.setHeadingOffset(offsetDeg)

    // Everything drawn is created once here and reused as the walker advances:
    // one chevron conveyor (a single instanced mesh), one stretch label, one destination pin.
    const conveyor = createConveyor()
    stage.world.add(conveyor.mesh)
    const pin = createDestinationPin()
    stage.world.add(pin.sprite)
    const label = createStretchLabel()
    stage.world.add(label.sprite)

    let position: LatLng | null = null
    /** The last fix handed to moveTo, kept to find the walker's place on a new route. */
    let lastFix: LatLng | null = null
    let progressM = 0
    /** Progress the chevrons are drawn for: it slides to progressM along with the camera. */
    let shownProgressM: number | null = null
    let offRouteM = 0
    let snapped = false
    let accuracyM: number | null = null
    let fixCount = 0
    /** Compass bearing the 2D arrow should point along. */
    let guideBearingDeg = bearingAt(route, 0)
    /** Progress of the turn the walker is being asked to re-align after, if any. */
    let realignAtM: number | null = null
    let pathReady = false

    /** Hand the conveyor the route in world coordinates (possible once the origin is known). */
    const preparePath = () => {
      const points: PathPoint[] = []
      for (let i = 0; i < route.waypoints.length; i++) {
        const at = stage.toWorld(route.waypoints[i].location)
        if (!at) return
        points.push({ x: at.x, z: at.z, alongM: route.distances[i] })
      }
      conveyor.setPath(
        points,
        route.waypoints.slice(0, -1).map((waypoint) => colorOf(waypoint.inSun)),
      )
      pathReady = true
    }

    /** Place the stretch label and the pin for the current progress. */
    const layout = () => {
      const marked = labelledStretch(route, progressM)
      const anchor = marked && stage.toWorld(pointAt(route, marked.atM))
      if (marked && anchor) {
        label.show(stretchText(marked.stretch), colorOf(marked.stretch.inSun), anchor.x, anchor.z)
      } else {
        label.hide()
      }

      const destination = stage.toWorld(route.waypoints[route.waypoints.length - 1].location)
      pin.sprite.visible =
        destination !== null && route.lengthM - progressM <= PIN_VISIBLE_WITHIN_M
      if (destination) pin.place(destination.x, destination.z)
    }

    const setRealignPrompt = (atM: number | null) => {
      if ((atM === null) !== (realignAtM === null)) setRealign(atM !== null)
      realignAtM = atM
    }

    /** Take a (smoothed) fix: snap it to the route, move the camera, redraw. */
    const moveTo = (fix: LatLng) => {
      lastFix = fix
      const previousM = position ? progressM : null
      const snap = snapToRoute(route, fix, previousM)
      progressM = snap.progressM
      offRouteM = snap.offsetM
      snapped = snap.offsetM <= SNAP_MAX_OFFSET_M
      const here = snapped ? snap.point : fix
      position = here
      stage.setPosition(here)
      if (!pathReady) preparePath()

      const ahead = pointAt(route, Math.min(progressM + COMPASS_LOOKAHEAD_M, route.lengthM))
      guideBearingDeg =
        distanceM(here, ahead) > 2 ? bearingDeg(here, ahead) : bearingAt(route, progressM)

      // Passing a turn: buzz, and ask for a fresh alignment (a compass is often wrong by a
      // different amount once the phone points a new way).
      if (previousM !== null) {
        for (let i = 1; i < route.turns.length - 1; i++) {
          const atM = route.distances[i]
          if (Math.abs(route.turns[i]) >= TURN_MIN_DEG && previousM < atM && atM <= progressM) {
            setRealignPrompt(atM)
            vibrate(VIBRATE_TURN_MS)
          }
        }
      }
      if (
        realignAtM !== null &&
        (progressM < realignAtM || progressM - realignAtM > REALIGN_PROMPT_CLEAR_M)
      ) {
        setRealignPrompt(null)
      }

      layout()
    }

    const applyHeadingOffset = (nextDeg: number) => {
      offsetDeg = nextDeg
      stage.setHeadingOffset(nextDeg)
      if (!desk) storeHeadingOffset(nextDeg)
      setHeadingOffsetDeg(nextDeg)
      setRealignPrompt(null)
    }

    actionsRef.current = {
      requestMotionPermission: () => stage.requestMotionPermission(),
      align: () => {
        const nextDeg = deltaDeg(stage.getCompassDeg(), bearingAt(route, progressM))
        // A compass is rarely this far out: more likely the phone isn't pointing along the path.
        if (Math.abs(nextDeg) > ALIGN_CONFIRM_DEG) setPendingAlignDeg(nextDeg)
        else applyHeadingOffset(nextDeg)
      },
      confirmAlign: applyHeadingOffset,
      resetAlign: () => applyHeadingOffset(0),
      setRoute: (next) => {
        if (next === route) return
        route = next
        // Progress on the old route means nothing on this one: find the walker's place afresh.
        position = null
        progressM = 0
        shownProgressM = null
        pathReady = false
        conveyor.setPath([], [])
        setRealignPrompt(null)
        if (desk) {
          setDeskProgressM(0)
          moveDeskRef.current?.(0)
        } else if (lastFix) {
          moveTo(lastFix)
        } else {
          layout()
        }
      },
    }

    // --- Accuracy gate: poor GPS for a while hides the 3D content, the 2D arrow takes over. ---
    let poorSinceMs: number | null = null
    /** Since when accuracy has been good enough to bring the 3D arrows back. */
    let goodSinceMs: number | null = null
    let gatedNow = false
    const setGate = (on: boolean) => {
      if (on === gatedNow) return
      gatedNow = on
      stage.world.visible = !on
      setGated(on)
    }

    /** Start watching GPS; returns the function that stops it. */
    const startGps = () => {
      const smoother = createFixSmoother()
      return watchGps(
        (fix) => {
          fixCount += 1
          accuracyM = fix.accuracyM
          setGps('ok')
          if (fix.accuracyM > GPS_GATE_ACCURACY_M) {
            poorSinceMs ??= performance.now()
            goodSinceMs = null
          } else {
            poorSinceMs = null
            // Between the two limits nothing changes, so one fix either side can't flip the view.
            if (fix.accuracyM <= GPS_GATE_EXIT_ACCURACY_M) goodSinceMs ??= performance.now()
            else goodSinceMs = null
          }
          const smoothed = smoother.push(fix)
          if (smoothed) moveTo(smoothed)
        },
        (failure) => {
          if (failure === 'denied' || failure === 'unsupported' || fixCount === 0) {
            setGps(failure)
          } else if (failure === 'unavailable') {
            // Signal lost after we had it: treat like poor accuracy.
            poorSinceMs ??= performance.now()
            goodSinceMs = null
          }
          // A timeout once fixes have arrived is ignored: it can just mean standing still.
        },
      )
    }

    let stopGps: (() => void) | null = null
    if (desk) {
      const moveDesk = (alongM: number) => {
        const sideways = bearingAt(route, alongM) + 90
        moveTo(destinationPoint(pointAt(route, alongM), sideways, DESK_SIDE_OFFSET_M))
        stage.setDeskHeading(bearingAt(route, progressM))
      }
      moveDeskRef.current = moveDesk
      moveDesk(0)
    } else {
      stopGps = startGps()
    }

    // In the background (screen off, another tab or app) nothing should keep running: no
    // rendering, no camera, no GPS, no motion sensors. Everything restarts on return.
    const onVisibilityChange = () => {
      if (document.hidden) {
        stage.pause()
        stopGps?.()
        stopGps = null
      } else {
        stage.resume()
        if (!desk && !stopGps) {
          poorSinceMs = null
          goodSinceMs = null
          stopGps = startGps()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.hidden) onVisibilityChange()

    let shownCard: CardInfo | null = null
    let elapsed = 0
    let frames = 0
    stage.onFrame((dtSeconds) => {
      // Each fix moves progress by a metre or more: slide there, or the chevrons pop in and out.
      shownProgressM =
        shownProgressM === null || Math.abs(progressM - shownProgressM) > POSITION_JUMP_M
          ? progressM
          : shownProgressM + (progressM - shownProgressM) * (1 - Math.exp(-dtSeconds / POSITION_GLIDE_S))
      conveyor.update(dtSeconds, shownProgressM)
      pin.fitToView(stage.camera)
      label.fitToView(stage.camera)

      if (
        !gatedNow &&
        poorSinceMs !== null &&
        performance.now() - poorSinceMs >= GPS_GATE_SECONDS * 1000
      ) {
        setGate(true)
      } else if (
        gatedNow &&
        goodSinceMs !== null &&
        performance.now() - goodSinceMs >= GPS_GATE_EXIT_SECONDS * 1000
      ) {
        setGate(false)
      }

      // The stage's heading is already steadied, so the 2D arrow and the 3D arrows turn together.
      const facingDeg = stage.getFacingDeg()
      if (gatedNow && compassArrowRef.current) {
        const turnDeg = deltaDeg(facingDeg, guideBearingDeg)
        compassArrowRef.current.style.transform = `rotate(${turnDeg.toFixed(1)}deg)`
      }

      elapsed += dtSeconds
      frames += 1
      if (elapsed < UI_REFRESH_S) return
      const nextCard = cardInfoFor(route, progressM, accuracyM, desk)
      if (!shownCard || !sameCard(shownCard, nextCard)) {
        shownCard = nextCard
        setCard(nextCard)
      }
      reportDebug({
        position,
        progressM,
        routeLengthM: route.lengthM,
        offRouteM,
        snapped,
        accuracyM,
        fixCount,
        facingDeg,
        compassDeg: stage.getCompassDeg(),
        headingOffsetDeg: offsetDeg,
        routeBearingDeg: bearingAt(route, progressM),
        gated: gatedNow,
        fps: frames / elapsed,
        drawCalls: stage.getDrawCalls(),
      })
      elapsed = 0
      frames = 0
    })

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      moveDeskRef.current = null
      actionsRef.current = null
      stopGps?.()
      // Scene content first, while the renderer can still free its GPU side; the stage last.
      conveyor.dispose()
      pin.dispose()
      label.dispose()
      stage.dispose()
    }
  }, [desk, hasRoute])

  // --- What to tell the walker when AR can't run (first match wins) ---------------------------
  const denied = [
    cameraFeed === 'denied' ? 'camera' : null,
    gps === 'denied' ? 'location' : null,
    motion === 'denied' ? 'motion sensors' : null,
  ].filter((name) => name !== null)

  let blocker: Blocker | null = null
  if (!route) {
    blocker = { title: 'No route', body: 'This route has no path to show.' }
  } else if (denied.length > 0) {
    blocker = {
      title: 'Permission denied',
      body: `SunSkip needs your ${listOf(denied)} to show the way. Allow ${denied.length > 1 ? 'them' : 'it'} for this site in your browser settings, then reload.`,
      action: 'reload',
    }
  } else if (cameraFeed === 'error') {
    blocker = {
      title: 'Camera unavailable',
      body: 'The camera could not be opened. It needs an HTTPS page and a camera no other app is using.',
    }
  } else if (motion === 'unsupported') {
    blocker = {
      title: 'No compass',
      body: 'This browser does not share motion sensors, so the arrows cannot follow the phone.',
    }
  } else if (gps === 'unsupported') {
    blocker = { title: 'No location', body: 'This browser has no location support.' }
  } else if (motion === 'needs-tap') {
    blocker = {
      title: 'One more step',
      body: 'Your phone asks before sharing its compass.',
      action: 'enable-motion',
    }
  }

  // AR can't run and a tap won't fix it: hand over to the host's arrow screen.
  const unavailable = blocker !== null && blocker.action !== 'enable-motion'
  const leaveForArrow = useEffectEvent(() => onUseArrow?.('unavailable'))
  useEffect(() => {
    if (unavailable) leaveForArrow()
  }, [unavailable])

  const findingGps = !blocker && gps === 'waiting'
  const noSignal = !blocker && (gps === 'timeout' || gps === 'unavailable')
  const showCompass = !blocker && gps === 'ok' && gated
  const located = !blocker && gps === 'ok'

  // Top card: the instruction, or what the GPS is doing while there isn't one yet.
  let cardShown = card
  if (findingGps) {
    cardShown = {
      icon: 'gps',
      title: 'Finding GPS…',
      subtitle: 'This takes a few seconds outdoors',
      sun: null,
      gps: null,
    }
  } else if (noSignal) {
    cardShown = {
      icon: 'gps',
      title: 'Move to open sky',
      subtitle: 'No GPS signal yet',
      sun: null,
      gps: 'poor',
    }
  }

  // Bottom sheet: help, or the most pressing status (first match wins).
  let message: SheetMessage
  if (pendingAlignDeg !== null) {
    message = {
      tone: 'warning',
      title: 'Are you pointing along the path?',
      text: `Recalibrating now would turn the arrows by ${Math.abs(Math.round(pendingAlignDeg))}°.`,
      actions: [
        { id: 'cancel-align', label: 'Cancel' },
        { id: 'confirm-align', label: 'Yes, recalibrate' },
      ],
    }
  } else if (blocker) {
    message = {
      tone: 'error',
      title: blocker.title,
      text: blocker.body,
      actions:
        blocker.action === 'reload'
          ? [{ id: 'reload', label: 'Reload' }]
          : blocker.action === 'enable-motion'
            ? [{ id: 'enable-motion', label: 'Enable motion sensors' }]
            : [],
    }
  } else if (noSignal) {
    message = {
      tone: 'warning',
      text: 'No GPS signal yet. Step away from buildings and trees.',
      actions: [],
    }
  } else if (showCompass) {
    message = {
      tone: 'warning',
      title: 'Move to open sky',
      text: 'GPS is too weak for the arrows. Follow the compass arrow for now.',
      actions: [],
    }
  } else if (realign && located) {
    message = {
      tone: 'warning',
      text: 'You turned. Point your phone along the path, then',
      actions: [{ id: 'recalibrate', label: 'Recalibrate' }],
    }
  } else {
    message = {
      tone: 'normal',
      text: 'Hold your phone up, facing the way you walk. Arrows off?',
      actions: [
        ...(located ? [{ id: 'recalibrate' as const, label: 'Recalibrate' }] : []),
        ...(located && headingOffsetDeg !== 0
          ? [
              {
                id: 'undo-align' as const,
                label: `Undo ${headingOffsetDeg > 0 ? '+' : ''}${Math.round(headingOffsetDeg)}°`,
              },
            ]
          : []),
        ...(onUseArrow ? [{ id: 'use-arrow' as const, label: 'Use arrow' }] : []),
      ],
    }
  }

  return (
    <div className="fixed inset-0 touch-none overflow-hidden bg-black select-none">
      {desk && (
        <div className="absolute inset-0 bg-linear-to-b from-sky-300 from-50% to-stone-500 to-50%" />
      )}
      <div ref={hostRef} className="absolute inset-0" />

      {cardShown && <InstructionCard info={cardShown} />}

      {showCompass && (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <div className="flex size-36 items-center justify-center rounded-full border-4 border-white bg-[#1d1814]/80">
            <div ref={compassArrowRef} className="size-24">
              <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
                <path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" />
              </svg>
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-2">
        {desk && route && (
          <label className="flex items-center gap-3 rounded-2xl bg-[#1d1814]/85 px-4 py-2.5 text-sm font-medium text-white">
            <span className="shrink-0 tabular-nums">
              {Math.round(deskProgressM)} / {Math.round(route.lengthM)} m
            </span>
            <input
              type="range"
              min={0}
              max={Math.floor(route.lengthM)}
              step={1}
              value={deskProgressM}
              onChange={(event) => {
                const alongM = Number(event.target.value)
                setDeskProgressM(alongM)
                moveDeskRef.current?.(alongM)
              }}
              className="min-w-0 grow"
            />
          </label>
        )}
        {accessory}
        <BottomSheet
          message={message}
          onSwitchToMap={onSwitchToMap}
          onClose={onClose}
          onAction={(action) => {
            if (action === 'reload') window.location.reload()
            else if (action === 'enable-motion') actionsRef.current?.requestMotionPermission()
            else if (action === 'recalibrate') actionsRef.current?.align()
            else if (action === 'undo-align') actionsRef.current?.resetAlign()
            else if (action === 'use-arrow') onUseArrow?.('chosen')
            else if (action === 'confirm-align') {
              if (pendingAlignDeg !== null) actionsRef.current?.confirmAlign(pendingAlignDeg)
              setPendingAlignDeg(null)
            } else setPendingAlignDeg(null)
          }}
        />
      </div>
    </div>
  )
}

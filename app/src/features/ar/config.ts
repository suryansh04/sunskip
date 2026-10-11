// Every tunable of the AR walk view lives here. Distances are metres, angles are degrees,
// times are seconds unless the name says otherwise. World y = 0 is eye level.

// --- Camera and renderer ----------------------------------------------------------------------

/** Browsers don't report the camera's field of view, so assume this along the video's long side. */
export const CAMERA_LONG_SIDE_FOV_DEG = 65
/** Requested rear-camera size; also assumed until the webcam reports its real size. */
export const VIDEO_WIDTH = 1280
export const VIDEO_HEIGHT = 720
export const MAX_PIXEL_RATIO = 1.5
export const CAMERA_NEAR_M = 0.1
export const CAMERA_FAR_M = 300

/**
 * LocAR slerps the camera by (1 - factor) per frame: higher is steadier but laggier.
 * Keep within 0.2-0.4.
 */
export const ORIENTATION_SMOOTHING_FACTOR = 0.3

// --- GPS ----------------------------------------------------------------------------------------

/** How far a walker can drift between fixes, in m/s: how much the filter trusts a new fix over the old position. */
export const GPS_WALK_NOISE_MPS = 1.5
/** A fix this many times further away than the filter and the fix's own accuracy explain is a jump, and dropped. */
export const GPS_JUMP_SIGMAS = 3
/** ...unless this many jumps come in a row: then the walker really is there (a tunnel, a long gap). */
export const GPS_JUMPS_TO_ACCEPT = 3
/** Fixes worse than this (cell towers, Wi-Fi guesses) are ignored once a better one has come in. */
export const GPS_WORST_ACCURACY_M = 100
/** How long to wait for a fix before reporting a timeout. */
export const GPS_TIMEOUT_MS = 15000
/** Ignore smoothed moves (and accuracy changes) smaller than this. */
export const GPS_MIN_MOVE_M = 1
/** GPS accuracy worse than this, for this long, swaps the 3D arrows for the 2D compass arrow. */
export const GPS_GATE_ACCURACY_M = 15
export const GPS_GATE_SECONDS = 5
/** The 3D arrows only come back after accuracy has been this good for this long, so the view doesn't flip. */
export const GPS_GATE_EXIT_ACCURACY_M = 12
export const GPS_GATE_EXIT_SECONDS = 2
/** The HUD dot is green at or below this accuracy, amber up to the gate, red beyond it. */
export const GPS_GOOD_ACCURACY_M = 8

/** Snap a fix onto the route if it is within this distance of it; beyond that, leave it be. */
export const SNAP_MAX_OFFSET_M = 25
/** Look for the snap point this far behind / ahead of the last progress before anywhere else. */
export const SNAP_SEARCH_BACK_M = 30
export const SNAP_SEARCH_AHEAD_M = 80

// --- Position -----------------------------------------------------------------------------------

/** The camera glides to each new fix over about this long instead of jumping there. */
export const POSITION_GLIDE_S = 0.5
/** A move longer than this (the first good fix after a bad one, a new route) is a jump, not a glide. */
export const POSITION_JUMP_M = 20

// --- Heading ------------------------------------------------------------------------------------

/** The 2D compass arrow points at the route this far ahead of the walker. */
export const COMPASS_LOOKAHEAD_M = 20
/** Time constant of the low-pass on the heading that drives the 2D compass arrow. */
export const HUD_HEADING_SMOOTHING_S = 0.25
/** A route bend at least this sharp counts as a turn: HUD, vibration and the re-align prompt. */
export const TURN_MIN_DEG = 45
/** The re-align prompt goes away by itself this far past the turn. */
export const REALIGN_PROMPT_CLEAR_M = 40
/** Align asks "are you pointing along the path?" before applying an offset larger than this. */
export const ALIGN_CONFIRM_DEG = 45

// --- What is drawn, and how far ahead -----------------------------------------------------------

/** The ground (chevrons, labels, foot of the pin) is this far below eye level. */
export const GROUND_BELOW_EYE_M = 1.5

export const COLOR_SHADE = 0x2f80ed
export const COLOR_SUN = 0xf2994a
/** Shade unknown. */
export const COLOR_UNKNOWN = 0x9ca3af

// --- 3D arrows (only the /ar-test page uses these now) ----------------------------------------

export const ARROW_WIDTH_M = 1.9
/** Tip to tail of a single chevron. */
export const ARROW_LENGTH_M = 1.5
/** Thickness of each chevron arm, front to back. */
export const ARROW_ARM_M = 0.75
/** How thick the arrow is extruded. */
export const ARROW_THICKNESS_M = 0.24
/** The next arrow is a double chevron: arm thickness and the gap between the two. */
export const ARROW_DOUBLE_ARM_M = 0.55
export const ARROW_DOUBLE_GAP_M = 0.3
/** Centre of the arrow below eye level: it hovers a little above the ground. */
export const ARROW_BELOW_EYE_M = 1.15
/** The sides of the arrow are this fraction as bright as its top, to show its thickness. */
export const ARROW_SIDE_SHADE = 0.72

/** White outline around the arrow, and a dark edge outside that, so it reads on any background. */
export const ARROW_OUTLINE_M = 0.07
export const ARROW_EDGE_M = 0.04
export const COLOR_OUTLINE = 0xffffff
export const COLOR_EDGE = 0x111827

/**
 * A flat arrow far away is a sliver, an upright one near you looks like a sign rather than a
 * marking on the path. So arrows lie flatter when near and lean back towards you when far.
 */
export const ARROW_TILT_NEAR_DEG = 22
export const ARROW_TILT_FAR_DEG = 42
export const ARROW_TILT_NEAR_M = 10
export const ARROW_TILT_FAR_M = 45
/** An arrow pointing straight across the view (a turn ahead) leans back this much instead. */
export const ARROW_TILT_SIDEWAYS_DEG = 62

/**
 * Arrows grow with distance so far ones don't shrink to specks: size multiplies by
 * (distance / ARROW_GROW_FROM_M) ^ ARROW_GROW_EXPONENT, never below 1 or above ARROW_GROW_MAX.
 */
export const ARROW_GROW_FROM_M = 12
export const ARROW_GROW_EXPONENT = 0.6
export const ARROW_GROW_MAX = 2.4

/** The next arrow pulses between 1 and 1 + this, and bobs up and down by BOB metres. */
export const ARROW_PULSE_AMOUNT = 0.1
export const ARROW_PULSE_SECONDS = 1.5
export const ARROW_BOB_M = 0.05
/** Arrows fade in, and fade out once passed, over this long. */
export const ARROW_FADE_SECONDS = 0.3

/** Soft dark patch on the ground under each arrow, as a multiple of the arrow's size. */
export const ARROW_SHADOW_SCALE = 1.7
export const ARROW_SHADOW_OPACITY = 0.6

// --- Chevron conveyor (the arrows on the path in ARView) ---------------------------------------

/** Flat chevrons stream forward along the path between these distances ahead of the walker. */
export const CONVEYOR_NEAR_M = 3
export const CONVEYOR_FAR_M = 60
/** Gap from one chevron to the next, and how fast they flow forward. */
export const CONVEYOR_SPACING_M = 2.75
export const CONVEYOR_SPEED_M_PER_S = 1.5
/** One chevron: width across the path, tip-to-tail length, arm thickness, white outline. */
export const CONVEYOR_CHEVRON_WIDTH_M = 1.25
export const CONVEYOR_CHEVRON_LENGTH_M = 0.8
export const CONVEYOR_CHEVRON_ARM_M = 0.34
export const CONVEYOR_OUTLINE_M = 0.045
/** Chevrons fade in over this stretch at the near end and out over this one at the far end. */
export const CONVEYOR_FADE_IN_M = 1.5
export const CONVEYOR_FADE_OUT_M = 18
/** The nearest chevrons are drawn this much bigger, shrinking to normal size by NEAR_BOOST_UNTIL_M. */
export const CONVEYOR_NEAR_BOOST = 0.25
export const CONVEYOR_NEAR_BOOST_UNTIL_M = 10
/** Far chevrons are drawn bigger by up to this factor, so they don't vanish into the path. */
export const CONVEYOR_FAR_GROW = 1.6
/**
 * Chevrons lie flat near the walker. Further away they lean up slightly, or a flat shape seen
 * from eye height at 40 m would be a line one pixel tall.
 */
export const CONVEYOR_TILT_FROM_M = 8
export const CONVEYOR_TILT_FULL_M = 40
export const CONVEYOR_TILT_FAR_DEG = 32
/** Colour multiplier at the far end (1 = full colour): near chevrons look brighter. */
export const CONVEYOR_FAR_BRIGHTNESS = 0.82

// --- Stretch label and destination pin ----------------------------------------------------------

/** Pill height and maximum width, as fractions of the view. */
export const STRETCH_LABEL_VIEW_HEIGHT = 0.05
export const STRETCH_LABEL_MAX_VIEW_WIDTH = 0.7
/** The pill marks the next stretch once its start is within this window ahead. */
export const STRETCH_LABEL_MIN_AHEAD_M = 4
export const STRETCH_LABEL_MAX_AHEAD_M = 80
/** Near the start of the route the current stretch is labelled instead, this far ahead. */
export const START_LABEL_UNTIL_M = 15
export const START_LABEL_AHEAD_M = 10
/** Text colour on the pill. */
export const STRETCH_LABEL_TEXT = '#1d1814'

/** The destination pin appears within this distance of the end, measured along the route. */
export const PIN_VISIBLE_WITHIN_M = 150
/** Pin height: this fraction of the view when far, never smaller than PIN_MIN_HEIGHT_M up close. */
export const PIN_VIEW_HEIGHT = 0.06
export const PIN_MIN_HEIGHT_M = 1.6
export const COLOR_PIN = 0x27ae60

// --- Instruction card ---------------------------------------------------------------------------

/** Walking speed used to turn metres of sun into minutes. */
export const WALK_SPEED_M_PER_MIN = 78
/** Within this distance of the end the instruction card says "You have arrived". */
export const ARRIVE_WITHIN_M = 8
/** Within this distance of a turn the card switches from "Continue ..." to "Turn left ...". */
export const TURN_SOON_M = 25
/** Buzz when a turn waypoint is passed (Android; iOS has no vibration API). */
export const VIBRATE_TURN_MS = 200

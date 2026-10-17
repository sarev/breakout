// Breakout (web version): all the tuning numbers in one place.
//
// These mirror the constants at the top of the classes in breakout.py, which is the reference implementation.
// Distances are logical playfield pixels at the 1080p reference (scaled to the viewport at run time, see
// graphics.js) and speeds are pixels per second.

// ---------------------------------------------------------------------------------------------------------------
// Time base
// ---------------------------------------------------------------------------------------------------------------

// Physics sub-step rate (steps per second). Each frame is split into equal steps no longer than 1 / PHYSICS_HZ.
export const PHYSICS_HZ = 240;

// Longest frame time we are prepared to simulate in one go (seconds): a stall is clamped so nothing teleports.
export const MAX_FRAME_DT = 1 / 20;

// ---------------------------------------------------------------------------------------------------------------
// Playfield
// ---------------------------------------------------------------------------------------------------------------

// Reference playfield that all sizes, speeds and mouse travel are designed against
export const REFERENCE_WIDTH = 1920;
export const REFERENCE_HEIGHT = 1080;

// The playfield's shape is the viewport's shape clamped to this range (width / height). Wider viewports get bars
// at the sides, narrower ones bars top and bottom. The upper limit is what matters: the brick grid is sized from
// the playfield width, so on anything wider than 16:9 the lower rows would run into the bat.
export const MIN_PLAYFIELD_ASPECT = 4 / 3;
export const MAX_PLAYFIELD_ASPECT = 16 / 9;

// Sprite heights as a percentage of the playfield height
export const BALL_HEIGHT_PCT = 4.5;
export const BAT_HEIGHT_PCT = 6;
export const LASER_HEIGHT_PCT = 6;

// ---------------------------------------------------------------------------------------------------------------
// Colours. The first nine are the explosion flashes for the corresponding brick types.
// ---------------------------------------------------------------------------------------------------------------
export const COLOURS = {
  blue: [64, 128, 255],
  red: [255, 164, 32],
  green: [64, 255, 128],
  white: [255, 255, 255],
  magenta: [224, 0, 192],
  yellow: [255, 240, 96],
  fire: [255, 32, 16],
  metal: [181, 192, 201],
  laser: [32, 32, 200],
  black: [0, 0, 0],
  lives: [196, 224, 255],
  advance: [128, 255, 192],
  level: [164, 240, 164],
  die: [255, 164, 164],
  win: [224, 224, 255],
  title: [64, 104, 191],
  copyright: [128, 168, 255],
  rights: [128, 168, 255],
  presskey: [64, 224, 224],
  item: [32, 164, 32],
  selitem: [96, 224, 96],
};
export const BRICK_COLOURS = Object.values(COLOURS).slice(0, 9);

// ---------------------------------------------------------------------------------------------------------------
// Bricks and levels
// ---------------------------------------------------------------------------------------------------------------

export const NUM_BRICK_TYPES = 9;

// Hits to destroy each brick type: blue, red (extra ball), green (extra bat), white (extra life), black (blackout),
// yellow (inversion), fire (cascade), metal (indestructible), dark blue (lasers)
export const BRICK_LIVES = [1, 3, 2, 2, 4, 3, 2, 99, 3];

// Brick layouts. 0 is filled randomly with blue / red / green by difficulty; 7 is metal; see breakout.py.
export const LEVEL_DEFS = [
  [
    [7, 0, 0, 0, 4, 0, 0, 0, 0, 7],
    [0, 0, 0, 0, 0, 3, 0, 0, 8, 0],
  ],
  [
    [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 4, 0, 0, 6, 0, 0, 0],
    [7, 0, 0, 0, 0, 7, 7, 0, 0, 3, 0, 7],
  ],
  [
    [0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0],
    [0, 7, 0, 6, 0, 8, 0, 3, 0, 0, 0, 0, 7, 5],
    [0, 0, 7, 6, 0, 0, 4, 0, 0, 0, 6, 7, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 7, 8, 0, 0, 0, 0, 3],
  ],
  [
    [0, 6, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 6, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0],
    [8, 0, 0, 4, 0, 5, 0, 0, 0, 0, 5, 0, 6, 0, 0, 0],
    [0, 0, 0, 0, 0, 7, 0, 3, 6, 0, 7, 0, 0, 0, 0, 0],
    [5, 0, 0, 0, 0, 0, 7, 7, 7, 7, 0, 0, 0, 4, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8],
  ],
  [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 6, 0, 0, 0, 0, 0, 5, 7, 0, 0, 4, 0, 0, 0, 0, 6, 0],
    [0, 0, 0, 0, 6, 0, 0, 8, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 4, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0],
    [0, 0, 0, 0, 7, 0, 0, 0, 0, 4, 7, 0, 6, 0, 0, 7, 0, 0, 0, 0],
    [3, 0, 5, 7, 0, 0, 0, 0, 7, 7, 0, 6, 0, 0, 0, 0, 7, 4, 0, 0],
    [0, 7, 7, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 5],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  [
    [7, 0, 0, 0, 0, 0, 5, 0, 0, 4, 0, 0, 4, 0, 0, 5, 0, 0, 0, 0, 0, 7],
    [0, 0, 7, 0, 6, 0, 0, 0, 0, 0, 8, 3, 0, 0, 0, 0, 0, 6, 0, 7, 0, 0],
    [0, 4, 0, 0, 0, 6, 0, 0, 5, 0, 0, 0, 5, 0, 0, 6, 0, 0, 0, 4, 0, 0],
    [0, 0, 0, 0, 0, 0, 7, 7, 7, 6, 0, 0, 6, 7, 7, 7, 0, 0, 0, 0, 0, 0],
    [0, 0, 4, 0, 0, 0, 7, 0, 0, 4, 0, 8, 4, 0, 0, 7, 0, 0, 0, 4, 0, 0],
    [0, 6, 0, 0, 7, 0, 0, 0, 6, 0, 7, 0, 0, 6, 0, 0, 7, 0, 0, 0, 6, 0],
    [5, 0, 0, 7, 0, 0, 0, 8, 0, 0, 6, 0, 0, 0, 8, 0, 0, 7, 0, 0, 0, 5],
    [0, 0, 0, 0, 0, 7, 0, 3, 6, 0, 7, 0, 6, 3, 0, 7, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 5, 0, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 5, 0, 0, 0],
    [7, 0, 0, 0, 0, 6, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 6, 0, 0, 0, 7],
  ],
];

// Mix of blue / red / green used to fill the 0 cells, per difficulty (ten entries, picked at random)
export const RANDOM_BRICK_TYPES = [
  [0, 0, 1, 1, 2, 2, 2, 2, 2, 2],
  [0, 0, 0, 0, 1, 1, 1, 2, 2, 2],
  [0, 0, 0, 0, 0, 1, 1, 1, 2, 2],
];

// ---------------------------------------------------------------------------------------------------------------
// Game rules
// ---------------------------------------------------------------------------------------------------------------

export const STARTING_LIVES = 3;        // Plus (2 - difficulty) bonus lives
export const INVERSION_SECONDS = 6;     // How long a yellow brick reverses the controls
export const BORING_TIMEOUT = 10;       // Seconds without a kill before a bonus ball is thrown in
export const MAX_BALLS = 6;             // Bonus balls are refused beyond this

// Laser mode
export const LASER_DURATION = 6;        // Seconds per laser brick (they stack)
export const LASER_PERIOD = 0.5;        // One beam per bat per this many seconds
export const LASER_STAGGER = 4 / 60;    // Offset between successive bats' beams
export const LASER_SPEED_FACTOR = 1.875; // Beam speed = playfield height * this, px/s

// Blackout (black hole brick): darkens at `rate` alpha units (0..255) per second, holds, then clears
export const BLACKOUT_RATE = 60;
export const BLACKOUT_HOLD = 0.75;

// ---------------------------------------------------------------------------------------------------------------
// Ball speed model (see DEVNOTES "Speed model")
// ---------------------------------------------------------------------------------------------------------------
export const BASE_BALL_SPEED = [480, 560, 640];     // Target speed on level 1 for easy, medium, hard
export const LEVEL_SPEED_RAMP = 1.08;               // Target multiplier per level above the first
export const MIN_SPEED_FRACTION = 0.75;             // Floor, as a fraction of the target
export const MAX_SPEED_FRACTION = 1.6;              // Ceiling, as a fraction of the target
export const BAT_HIT_SPEED_GAIN = [0.01, 0.02, 0.03]; // Speed added per bat hit, fraction of target
export const KICK_SPEED_GAIN = 0.15;                // Speed added per click, fraction of target
export const ENDGAME_SPEED_BOOST = 0.35;            // Extra target speed with the field fully cleared

// Serving
export const SERVE_TIMEOUT = 3;         // Seconds the ball waits on the bat before serving itself
export const SERVE_FLICK_GAIN = 1;      // Bat sideways speed -> ball sideways speed on release
export const SERVE_MAX_ANGLE = 60;      // Degrees from vertical
export const SERVE_JITTER = 3;          // Degrees of randomness on a still-bat serve

// Ball / bat contact
export const MAX_BAT_ANGLE = 60;        // Degrees from vertical when landing at the very end of the flat top
export const BAT_ANGLE_JITTER = 2;      // Degrees of randomness on each bat hit
export const BAT_HIT_COOLDOWN = 0.25;   // No further bat hits add speed for this long after one

// Bats
export const BAT_LIFETIME = 10;         // Seconds a bonus bat stays in play
export const BAT_FADE_SECONDS = 2;      // Warning fade before it goes
export const BAT_VELOCITY_SMOOTHING = 0.06; // Time constant for the smoothed sideways speed

// Anti-cheat (see wipe.js): wiping the bat from side to side fast enough sweeps the whole playfield and nothing
// can get past. A leg is one sweep in one direction; enough long, quick legs in a short window tire the bat,
// which then moves no faster than WIPE_TIRED_SPEED playfield widths per second for a while. One desperate
// swipe to reach a ball is a single leg and never enough, and a leg only counts while the hero ball is on
// its way down: darting about while it's heading up (chasing bonus balls, say) is just playing.
export const WIPE_LEG_TRAVEL = 0.3;     // Playfield widths a sweep must cover to count...
export const WIPE_LEG_SECONDS = 0.6;    // ...and be quicker than
export const WIPE_LEGS = 5;             // Counting sweeps within the window that tire the bat
export const WIPE_WINDOW = 2;           // Seconds
export const WIPE_PENALTY = 2.5;        // Seconds the bat stays tired
export const WIPE_TIRED_SPEED = 0.25;   // Playfield widths per second the bat can manage while tired
export const WIPE_HYSTERESIS = 0.01;    // Playfield widths of reverse travel before a sweep counts as turned round

// Touch
export const TOUCH_DRAG_GAIN = 1;       // Bat movement per finger movement when dragging in play (times sensitivity):
                                        // 1 keeps the bat exactly in step with the finger; more and it runs ahead
export const MOBILE_BAT_LIFT = 2;       // Bat heights the bats sit higher on a mobile device, clear of the fingertip
export const MOBILE_BAT_WIDEN = 2;      // Bats this many times wider on a mobile device in landscape, so that they
                                        // show either side of the finger driving them (the end caps keep their shape)
export const MOBILE_WIDE_ASPECT = 1.5;  // ...when the playfield is at least this wide for its height (landscape)

// Intro
export const INTRO_DAMPING = 0.887;     // Fraction of speed an intro ball keeps after one second
export const INTRO_BALLS = 15;
export const CARD_PITCH_RATE = 20;      // Degrees per second
export const CARD_YAW_RATE = 40;
export const CARD_ROLL_RATE = 10;

// Trails: alpha units (0..255) subtracted per second
export const TRAIL_FADE_GAME = 600;
export const TRAIL_FADE_INTRO = 1200;

// ---------------------------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------------------------
export const SOUND_NAMES = [
  'ball-hit', 'bat-hit', 'bonus', 'brick-hit', 'click', 'die', 'drop', 'restore', 'tick', 'wall-hit', 'win',
  'explode0', 'explode1', 'explode2', 'explode3', 'explode4', 'explode5', 'explode6', 'explode7', 'explode8',
  'laser0', 'laser1', 'laser2',
];
export const MUSIC_VOLUME = 0.4;
export const MUSIC_FADE_SECONDS = 0.8;
export const MUSIC_FILES = { intro: 'intro.ogg', stage1: 'stage1.ogg', stage2: 'stage2.ogg', boss: 'boss.ogg' };

// What each level plays, as [track, tempo]. Levels past the end cycle. Tempo changes pitch too, old-school style.
export const MUSIC_LEVEL_PLAN = [
  ['stage1', 1.0], ['stage2', 1.0], ['boss', 1.0],
  ['stage1', 1.2], ['stage2', 1.1], ['boss', 1.2],
];

// Full volume for speed-scaled effects is reached at this speed (px/s at the reference resolution)
export const FULL_VOLUME_SPEED = 3000;

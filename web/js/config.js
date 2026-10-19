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
// Balls spin as they travel (the sprite is rotated): at BALL_SPIN_RATE of the rate a ball rolling on the ground
// would turn (one turn per circumference covered), but never faster than BALL_SPIN_MAX_TURNS a second, or a
// fast ball is a blur. The sense follows the direction of travel: clockwise heading right, anticlockwise left.
export const BALL_SPIN_RATE = 1;
export const BALL_SPIN_MAX_TURNS = 3;
// Spin from the bat: swiping the bat along under a ball as it bounces sets it spinning, the bat dragging its
// underside along (a swipe to the right spins it anticlockwise): BAT_SPIN_PER_SWIPE turns a second for each
// playfield width a second the bat is moving, up to BALL_SPIN_MAX. The spin bends the path the way the ball turns,
// by BALL_CURVE_PER_TURN degrees a second for each turn a second, and dies away with a time constant of
// BALL_SPIN_FADE seconds, less as each bounce uses some up. Left alone, the whole bend would come to the starting
// rate times BALL_SPIN_FADE: 150 degrees for a brisk swipe of a width a second, and more for a whip. What keeps
// that in hand is that no bend takes a path within BALL_CURVE_FLATTEST degrees of horizontal, so a ball sent up can
// never curl round and come back down, however hard the bat was whipped (the bend
// eases off over the BALL_CURVE_EASE degrees before that, so it dies down rather than stopping dead).
// Spin also tells on a bounce: the surface grips the spinning ball and kicks it sideways, by BALL_SPIN_GRIP of
// the speed its surface is turning at (against that surface's motion, as topspin kicks a ball on along the
// floor), and BALL_SPIN_BOUNCE_KEEP of the spin is left afterwards. A kick that would take a path flatter than
// BALL_CURVE_FLATTEST (and flatter than the plain bounce), or turn a rising ball into a falling one, is left out.
export const BAT_SPIN_PER_SWIPE = 4;
export const BALL_SPIN_MAX = 5;
export const BALL_CURVE_PER_TURN = 15;
export const BALL_SPIN_FADE = 2.5;
export const BALL_CURVE_FLATTEST = 25;
export const BALL_CURVE_EASE = 15;
export const BALL_SPIN_GRIP = 0.3;
export const BALL_SPIN_BOUNCE_KEEP = 0.7;
export const INTRO_HERO_SCALE = 2;      // The intro's hero ball is drawn this many times the size of a ball in play
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
  haze: [255, 48, 48],
  net: [64, 160, 255],
  regen: [224, 64, 208],
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
export const BRICK_COLOURS = [
  COLOURS.blue, COLOURS.red, COLOURS.green, COLOURS.white, COLOURS.magenta, COLOURS.yellow, COLOURS.fire,
  COLOURS.metal, COLOURS.laser, COLOURS.haze, COLOURS.net, COLOURS.regen,
];

// ---------------------------------------------------------------------------------------------------------------
// Bricks and levels
// ---------------------------------------------------------------------------------------------------------------

export const NUM_BRICK_TYPES = 12;

// Hits to destroy each brick type: blue, red (extra ball), green (extra bat), white (extra life), black (blackout),
// yellow (inversion), fire (cascade), metal (indestructible), dark blue (lasers), red lens (haze), safety net,
// regenerator
export const BRICK_LIVES = [1, 3, 2, 2, 4, 3, 2, 99, 3, 3, 2, 3];

// Brick layouts. 0 is filled randomly with blue / red / green by difficulty; 7 is metal; see breakout.py. The
// red lens bricks (9) sit in the top rows, out of the way early on, and these layouts carry Hard's full set:
// one on level 4, two on 5, three on 6. Medium keeps one per level and Easy none (see Game.createBricks).
// Safety nets (10) are scattered about as freely as the laser bricks (8), and the two deepest levels have one in
// their bottom row, where the player starts.
export const LEVEL_DEFS = [
  [
    [7, 0, 0, 0, 4, 0, 0, 0, 0, 7],
    [0, 10, 0, 0, 0, 3, 0, 0, 8, 0],
  ],
  [
    [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0],
    [0, 11, 0, 0, 0, 4, 0, 0, 6, 0, 0, 0],
    [7, 0, 0, 0, 0, 7, 7, 0, 0, 3, 0, 7],
  ],
  [
    [0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0],
    [0, 7, 0, 6, 0, 8, 0, 3, 0, 0, 10, 0, 7, 5],
    [0, 0, 7, 6, 0, 0, 4, 0, 11, 0, 6, 7, 0, 0],
    [0, 0, 0, 0, 10, 0, 0, 7, 8, 0, 0, 0, 0, 3],
  ],
  [
    [0, 6, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 6, 0, 0, 11, 0, 0, 4, 0, 0, 0, 9, 0, 0, 0],
    [8, 0, 0, 4, 0, 5, 0, 0, 0, 0, 5, 0, 6, 0, 10, 0],
    [0, 0, 0, 0, 0, 7, 0, 3, 6, 0, 7, 0, 0, 0, 0, 0],
    [5, 0, 0, 0, 0, 0, 7, 7, 7, 7, 0, 11, 0, 4, 0, 0],
    [0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8],
  ],
  [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 3, 0, 0, 0, 0, 0, 9, 0, 0, 0],
    [0, 0, 0, 6, 0, 0, 0, 0, 0, 5, 7, 0, 0, 4, 0, 9, 0, 0, 6, 0],
    [0, 11, 0, 0, 6, 0, 0, 8, 0, 0, 4, 0, 0, 0, 10, 0, 0, 0, 0, 0],
    [0, 0, 4, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0],
    [0, 0, 0, 0, 7, 0, 0, 0, 0, 4, 7, 0, 6, 0, 0, 7, 0, 0, 0, 0],
    [3, 0, 5, 7, 0, 0, 0, 0, 7, 7, 0, 6, 0, 0, 11, 0, 7, 4, 0, 0],
    [0, 7, 7, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 5],
    [0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  [
    [7, 0, 0, 9, 0, 0, 5, 0, 0, 4, 0, 0, 4, 0, 0, 5, 0, 0, 0, 0, 0, 7],
    [0, 10, 7, 0, 6, 0, 0, 0, 0, 0, 8, 3, 0, 0, 9, 0, 0, 6, 0, 7, 10, 0],
    [0, 4, 0, 0, 0, 6, 0, 0, 5, 0, 9, 0, 5, 0, 0, 6, 0, 0, 0, 4, 0, 0],
    [0, 0, 11, 0, 0, 0, 7, 7, 7, 6, 0, 0, 6, 7, 7, 7, 0, 0, 0, 0, 0, 0],
    [0, 0, 4, 0, 0, 0, 7, 0, 0, 4, 0, 8, 4, 0, 0, 7, 0, 0, 0, 4, 0, 0],
    [0, 6, 0, 0, 7, 0, 0, 0, 6, 0, 7, 0, 0, 6, 0, 0, 7, 0, 0, 0, 6, 0],
    [5, 10, 0, 7, 0, 0, 0, 8, 0, 0, 6, 0, 0, 0, 8, 0, 0, 7, 0, 0, 10, 5],
    [0, 0, 0, 0, 0, 7, 0, 3, 6, 0, 7, 0, 6, 3, 0, 7, 0, 0, 0, 11, 0, 0],
    [0, 0, 0, 5, 0, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0, 0, 0, 5, 0, 0, 0],
    [7, 0, 10, 0, 0, 6, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 6, 0, 10, 0, 7],
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
export const DEBUG_LIVES = 99;          // Lives in ?debug=1 mode instead, so testing a late level isn't cut short
export const INVERSION_SECONDS = 6;     // How long a yellow brick reverses the controls
export const BORING_TIMEOUT = 10;       // Seconds without a kill before a bonus ball is thrown in
export const MAX_BALLS = 6;             // Bonus balls are refused beyond this

// Laser mode
export const LASER_DURATION = 6;        // Seconds per laser brick (they stack)
export const LASER_PERIOD = 0.5;        // One beam per bat per this many seconds
export const LASER_STAGGER = 4 / 60;    // Offset between successive bats' beams
export const LASER_SPEED_FACTOR = 1.875; // Beam speed = playfield height * this, px/s

// Safety net (brick 10): a glowing bar floats up from below the screen to just under the bat, stays a while,
// pulses in and out as a warning, then floats away. Balls that reach it bounce back up a little slower than
// they arrived, warning or not.
export const NET_HOLD = 5;              // Seconds the net stays up (another net brick adds the same again)
export const NET_WARNING = 4;           // Seconds of pulsing after that, before it floats away
export const NET_WARNING_PULSE = 0.5;   // Seconds per pulse of the warning (NET_WARNING is a whole number of them)
export const NET_WARNING_FAINTEST = 0.2;   // The opacity at the bottom of each warning pulse
export const NET_TRAVEL = 0.6;          // Seconds to float in or out
export const NET_GAP = 0.2;             // Bat heights between the bottom of the bat and the top of the net
export const NET_THICKNESS = 0.5;       // Bat heights thick
export const NET_SLOW = 0.85;           // The ball's speed is multiplied by this on the bounce
export const NET_PULSE = 0.8;           // Seconds per pulse of the glow

// Regenerator (brick 11): breaking it brings back a share of the level's broken bricks, one at a time, each
// popping into the place of a brick already destroyed (never one a ball is in), as an ordinary brick.
export const REGEN_FRACTION = 0.1;      // Share of the level's destructible bricks brought back (at least one)
export const REGEN_INTERVAL = 0.4;      // Seconds between one brick popping in and the next
export const REGEN_POP = 0.25;          // Seconds a returning brick takes to grow to full size
export const REGEN_PATIENCE = 2;        // Seconds to wait for a free spot before giving up on the rest

// Blackout (black hole brick): darkens at `rate` alpha units (0..255) per second, holds, then clears
export const BLACKOUT_RATE = 60;
export const BLACKOUT_HOLD = 0.75;

// Haze (red lens brick): the view blurs and a red haze creeps in from the edges for HAZE_SECONDS, fading away
// over the last HAZE_FADE_SECONDS of that. Each lens has its own spell, and while they overlap they add up.
export const HAZE_SECONDS = 15;
export const HAZE_FADE_SECONDS = 5;
export const HAZE_BLUR_PER_BRICK = 2.5;     // Blur radius per brick, px at the reference scale
export const HAZE_BLUR_MAX = 8;
export const HAZE_VIGNETTE_PER_BRICK = 0.3; // Opacity of the red at the edges, per brick
export const HAZE_VIGNETTE_MAX = 0.85;

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

// Anti-cheat (see wipe.js): wobbling the bat from side to side fast enough guards a whole stretch of the bottom
// edge and nothing can get past. A bat that turns round more than WIPE_TURNS times in WIPE_WINDOW seconds is
// tired, and then moves no faster than WIPE_TIRED_SPEED playfield widths per second for a while. A turn only
// counts at the end of a leg of at least WIPE_LEG_TRAVEL, so the jitter of a tilt-steered bat, which turns
// round constantly but goes nowhere, doesn't count; one desperate swipe to reach a ball is one turn.
export const WIPE_TURNS = 8;            // Turns within the window that tire the bat
export const WIPE_WINDOW = 1;           // Seconds
export const WIPE_LEG_TRAVEL = 0.02;    // Playfield widths a leg must cover for its turn to count (about a
                                        // quarter of the bat's width: jitter is far less, a wobble more)
export const WIPE_PENALTY = 2.5;        // Seconds the bat stays tired
export const WIPE_TIRED_SPEED = 0.25;   // Playfield widths per second the bat can manage while tired
export const WIPE_HYSTERESIS = 0.01;    // Playfield widths of reverse travel before a sweep counts as turned round

// Touch
export const MOBILE_BAT_LIFT = 1;       // Bat heights the bats sit higher on a mobile device, clear of the fingertip
export const MOBILE_BAT_WIDEN = 1.5;    // Bats this many times wider on a mobile device in landscape, so that they
                                        // show either side of the finger driving them (the end caps keep their shape)
export const MOBILE_WIDE_ASPECT = 1.5;  // ...when the playfield is at least this wide for its height (landscape)

// Intro on a phone: the hero ball rolls with the device's tilt, like a ball on a tray
export const TILT_ACCEL = 4500;         // Acceleration (px/s^2 at the reference scale) at a full 90 degrees of tilt
export const TILT_DAMPING = 0.3;        // Fraction of the hero ball's speed kept after one second (rolling friction)

// Insane (phones only): the bat is steered by rolling the phone like a steering wheel (see tilt.js); the game
// otherwise plays as Hard. These were dialled in on a Galaxy S23 with web/tilt.html.
export const TILT_BAT_FULL_PORTRAIT = 45;   // Degrees of roll that put the bat against the edge, in portrait...
export const TILT_BAT_FULL_LANDSCAPE = 37;  // ...and in landscape, where the wider screen wants a touch less lean
export const TILT_BAT_DEAD_ZONE = 2;        // Degrees either side of level that leave the bat centred
export const TILT_BAT_SMOOTHING = 0.06;     // Low-pass time constant on the gravity reading, seconds
export const TILT_BAT_FLAT = 80;            // Degrees of pitch beyond which the phone is too flat to read a roll

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
  'ball-hit', 'bat-hit', 'bonus', 'brick-hit', 'click', 'die', 'drop', 'net', 'respawn', 'restore', 'tick',
  'wall-hit', 'win',
  'explode0', 'explode1', 'explode2', 'explode3', 'explode4', 'explode5', 'explode6', 'explode7', 'explode8',
  'explode9', 'explode11',   // No explode10: the safety net's sound is 'net', as it rises
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

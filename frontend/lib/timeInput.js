// What a box that holds a clock string has to ask the phone for.
//
// A lap time is "1:23.456" — digits, a colon AND a decimal point. The colon is
// the problem: a phone only ever offers one on the full keyboard. Every numeric
// keypad a browser can raise (inputMode "numeric", "decimal" or "tel", and
// type="number") is digits plus at most a decimal separator, with no colon key
// on it and, on iOS, no way to switch to a layer that has one. An iPhone typing
// into such a box can enter seconds and nothing longer.
//
// That is the bug this module exists to stop coming back: the Time Trials sheet
// asked its lap inputs for inputMode="decimal", and every admin entering laps
// from a phone was locked out of typing a lap over a minute — on most tracks,
// every lap of the night.
//
// So a time box asks for text and nothing else. Nothing is lost on a desktop,
// where inputMode is ignored; on iOS the digits, ":" and "." all sit together
// on the keyboard's "123" layer, one tap from the letters. The remaining props
// turn off the things a phone does to TEXT that a clock reading never wants:
// autocorrect rewriting "1:23.456", a capital letter on the interval marker
// "1L", a browser autofill menu covering the next row of the grid, or a red
// spell-check underline through every lap.
//
// Spread onto any input that takes a time or a gap (see lib/raceTime.js for the
// formats they parse):
//
//   <input {...TIME_INPUT_PROPS} value={lap} onChange={…} />
//
export const TIME_INPUT_PROPS = {
  type: "text",
  inputMode: "text",
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
};

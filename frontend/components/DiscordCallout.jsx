"use client";

// The league's Discord invite. Hard-coded rather than stored per league,
// because there is one league running this and one invite — change it HERE and
// every place it appears follows. (It's linked from the Sign-ups screen; the
// sign-up form separately requires each player's Discord NAME, which is a
// different thing: that's how the league finds them once they're in.)
//
// https rather than the http the invite is usually written as: discord.gg
// redirects to https anyway, and there's no reason to send a player through a
// plaintext hop first.
export const DISCORD_INVITE_URL = "https://discord.gg/pra";

// Discord's own mark, inline so it needs no asset and follows the text colour.
function DiscordMark() {
  return (
    <svg viewBox="0 0 24 18" width="26" height="20" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M20.317 1.492A19.79 19.79 0 0 0 15.432 0c-.21.375-.455.88-.623 1.28a18.27 18.27 0 0 0-5.487 0A12.6 12.6 0 0 0 8.69 0 19.736 19.736 0 0 0 3.8 1.496C.703 6.093-.138 10.575.276 14.994a19.9 19.9 0 0 0 6.014 3.03c.485-.66.917-1.362 1.29-2.1a12.9 12.9 0 0 1-2.032-.978c.171-.126.338-.257.5-.392a14.2 14.2 0 0 0 12.06 0c.164.14.33.271.5.392-.647.383-1.328.71-2.036.98.373.737.804 1.439 1.29 2.098a19.84 19.84 0 0 0 6.017-3.03c.485-5.124-.83-9.565-3.462-13.502ZM8.02 12.276c-1.183 0-2.157-1.086-2.157-2.42 0-1.332.953-2.42 2.157-2.42 1.21 0 2.177 1.096 2.156 2.42 0 1.334-.953 2.42-2.156 2.42Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.332.954-2.42 2.157-2.42 1.21 0 2.177 1.096 2.156 2.42 0 1.334-.946 2.42-2.156 2.42Z" />
    </svg>
  );
}

// "You have to be in the Discord" — said on the Sign-ups screen, where a player
// is deciding to join, and again on the confirmation, where it's the one thing
// still left to do.
//
// It's a requirement rather than a suggestion, so it's drawn as a full-width
// card in Discord's own blurple rather than as a line of small print: a player
// who misses this fills in the whole form and then isn't given a role, which
// looks to them like the sign-up failed.
//
// `variant="next"` phrases it as the next step rather than as a prerequisite —
// same link, same requirement, but by then they've already signed up.
export function DiscordCallout({ variant = "before" }) {
  return (
    <section className="discord-callout" aria-labelledby="discord-callout-title">
      <span className="discord-callout-mark" aria-hidden="true"><DiscordMark /></span>
      <div className="discord-callout-body">
        <strong id="discord-callout-title">Discord is mandatory to race in this league.</strong>
        <span>
          {variant === "next"
            ? <>Now hop into the Discord and let us know who you are by picking the correct roles in
                the channels — that&rsquo;s what finishes getting you signed up.</>
            : <>Please log into the Discord and let us know who you are by selecting the correct
                roles in the channels to get signed up.</>}
        </span>
      </div>
      <a className="btn discord-callout-btn" href={DISCORD_INVITE_URL}
        target="_blank" rel="noopener noreferrer">
        Open our Discord
        {/* Says it leaves the app, for anyone who'd rather not lose the form. */}
        <span aria-hidden="true">↗</span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </section>
  );
}

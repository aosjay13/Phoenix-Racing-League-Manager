import { RaceEditScreen } from "./RaceEditScreen";

// A static shell. Everything this editor shows, points preview included is worked out in the browser (see
// RaceEditScreen.jsx), so there is nothing for a server render to add — and without
// this, a dynamic route segment makes Vercel spin up a function on every visit
// just to hand back HTML that is identical for every event.
//
// `generateStaticParams` returning nothing plus `dynamicParams` means: don't
// enumerate events at build time (there are as many as the league has, and
// they change), but serve any id from the same prerendered shell.
export const dynamic = "force-static";
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export default function Page() {
  return <RaceEditScreen />;
}

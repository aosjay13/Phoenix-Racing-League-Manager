import { db } from "@/lib/firebase";

// Outbound email, queued as a Firestore document rather than sent inline.
//
// The shape written here is the one Firebase's official **Trigger Email from
// Firestore** extension consumes: a doc in `mail` carrying `to` and a `message`
// of `{ subject, text, html }`. The extension watches that collection and does
// the sending, which is why this file needs no SMTP credentials, no third-party
// SDK and no new dependency — and why a request never waits on a mail server to
// answer before it can return.
//
// IF THAT EXTENSION (or any worker reading `mail`) IS NOT INSTALLED, nothing is
// delivered: the documents simply pile up, harmlessly, as a record of what
// should have gone out. That is deliberate — a league without email set up
// still gets the whole feature, because everything email says is also said in
// the app itself (see the denial notice on the Sign-ups screen). Email is the
// nudge; the app is the source of truth.
//
// Nothing here ever throws into a caller. An email failing to queue must not
// fail the thing that triggered it: an admin denying a sign-up has made a
// decision, and that decision is recorded whether or not the player can be
// mailed about it.

export const MAIL_COLLECTION = "mail";

// Queue one message. Returns the doc id, or null when there was nothing to send
// (no address) or the write failed.
export async function queueEmail({ to, subject, text, html, kind = "", meta = {} }) {
  const address = String(to ?? "").trim();
  // An account with no email on file — possible for a player an admin created
  // by hand — is not an error, just nothing to do.
  if (!address || !address.includes("@")) return null;
  try {
    const ref = await db().collection(MAIL_COLLECTION).add({
      to: [address],
      message: {
        subject: String(subject ?? "").trim().slice(0, 200),
        text: String(text ?? ""),
        ...(html ? { html: String(html) } : {}),
      },
      // Our own metadata, ignored by the extension, kept so an admin can see
      // what the app has tried to send and why.
      queued_at: new Date().toISOString(),
      kind,
      ...meta,
    });
    return ref.id;
  } catch (err) {
    console.error("Queueing email failed", err);
    return null;
  }
}

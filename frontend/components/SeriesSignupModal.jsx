"use client";

import { Modal } from "@/components/Modal";
import { SignupForm } from "@/components/SignupForm";

// The sign-up form in a dialog, for the places that open it from a button — a
// season's own screen. The Dashboard's Series Information section renders the
// same <SignupForm> inline under its season selector instead, so the two ways
// in ask for exactly the same things.
export function SeriesSignupModal({ season, driver, onClose, onDone }) {
  return (
    <Modal title={`Sign up — ${season.series_name}`} onClose={onClose}>
      <SignupForm season={season} driver={driver} onDone={onDone} onCancel={onClose} />
    </Modal>
  );
}

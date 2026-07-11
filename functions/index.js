// ─── functions/index.js ─────────────────────────────────────────────────────
// Admin-only user management for ProTrak. Everything here exists because the
// client-side Firebase SDK deliberately cannot do these two things safely:
//   1. Create a new Auth account without hijacking the Admin's own session
//   2. Change another user's password without knowing their current one
// Both require the Firebase Admin SDK, which only runs server-side — hence
// this separate functions/ project, deployed independently of the React app.
//
// Every function here re-checks that the caller is an admin on the server
// side (never trust the client's claim of its own role) before doing
// anything. If a call fails auth/permission checks, it throws before any
// write happens.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

// User IDs (e.g. "store1") aren't real email addresses, but Firebase Auth
// requires an email-shaped identifier under the hood. This fixed internal
// domain is never sent anywhere or shown to anyone — it's purely an
// implementation detail of how the User ID gets turned into something
// Firebase Auth will accept. Change this only if you also update the client
// (LoginScreen / UserManager) to match.
const INTERNAL_EMAIL_DOMAIN = "users.mahendraindustries.in";

function userIdToEmail(userId) {
  return `${userId.toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}

async function assertIsAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const callerDoc = await admin.firestore().collection("users").doc(request.auth.uid).get();
  if (!callerDoc.exists || callerDoc.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Only admins can manage users.");
  }
}

function validateUserId(userId) {
  if (!userId || typeof userId !== "string") {
    throw new HttpsError("invalid-argument", "User ID is required.");
  }
  const trimmed = userId.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(trimmed)) {
    throw new HttpsError(
      "invalid-argument",
      "User ID must be 3-30 characters: lowercase letters, numbers, dots, underscores, or hyphens only (no @ symbol)."
    );
  }
  return trimmed;
}

function validatePassword(password) {
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new HttpsError("invalid-argument", "Password must be at least 6 characters.");
  }
}

// ─── createUser ──────────────────────────────────────────────────────────────
// Creates the real Firebase Auth account AND the Firestore profile doc in one
// step — replacing the old flow where Admin had to manually create the auth
// account in the Firebase Console and then patch the Firestore doc ID by hand.
exports.createUser = onCall(async (request) => {
  await assertIsAdmin(request);

  const { userId, name, role, password, can_purchase, isPurchaseManager, wo_access, inventory_access } = request.data;
  const cleanUserId = validateUserId(userId);
  validatePassword(password);
  if (!name || !name.trim()) throw new HttpsError("invalid-argument", "Name is required.");
  if (!role) throw new HttpsError("invalid-argument", "Role is required.");

  const email = userIdToEmail(cleanUserId);

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name.trim(),
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", `User ID "${cleanUserId}" is already taken.`);
    }
    throw new HttpsError("internal", `Could not create account: ${e.message}`);
  }

  try {
    await admin.firestore().collection("users").doc(userRecord.uid).set({
      user_id: cleanUserId,
      email,
      name: name.trim(),
      role,
      can_purchase: !!can_purchase,
      isPurchaseManager: !!isPurchaseManager,
      wo_access: !!wo_access,
      inventory_access: !!inventory_access,
      created_by: request.auth.uid,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Firestore write failed after the Auth account was already created —
    // clean up so we don't leave an orphaned login with no profile.
    await admin.auth().deleteUser(userRecord.uid).catch(() => {});
    throw new HttpsError("internal", `Account created but profile save failed, rolled back: ${e.message}`);
  }

  return { uid: userRecord.uid, userId: cleanUserId };
});

// ─── resetPassword ───────────────────────────────────────────────────────────
// The one thing the client SDK genuinely cannot do: change another account's
// password without knowing the current one. This is why this whole
// functions/ project exists.
exports.resetPassword = onCall(async (request) => {
  await assertIsAdmin(request);

  const { uid, newPassword } = request.data;
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  validatePassword(newPassword);

  try {
    await admin.auth().updateUser(uid, { password: newPassword });
  } catch (e) {
    throw new HttpsError("internal", `Could not reset password: ${e.message}`);
  }

  return { success: true };
});

// ─── deleteUser ──────────────────────────────────────────────────────────────
// Removes both the Auth account and the Firestore profile doc. The old
// "Remove" button likely only deleted the Firestore doc, leaving a login that
// still worked but pointed at nothing — this fixes that.
exports.deleteUser = onCall(async (request) => {
  await assertIsAdmin(request);

  const { uid } = request.data;
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You can't delete your own account.");
  }

  await admin.auth().deleteUser(uid).catch((e) => {
    // If the Auth account is already gone, don't block cleaning up the
    // Firestore doc — but any other error should stop and surface.
    if (e.code !== "auth/user-not-found") throw new HttpsError("internal", `Could not delete account: ${e.message}`);
  });
  await admin.firestore().collection("users").doc(uid).delete();

  return { success: true };
});

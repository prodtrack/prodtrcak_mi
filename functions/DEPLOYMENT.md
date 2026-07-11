# Deploying the User Management Cloud Functions

These three functions (`createUser`, `resetPassword`, `deleteUser`) live in
`functions/` at the root of your Firebase project — a sibling to your React
app, not part of it. They deploy straight to Firebase, not through Vercel.

## Prerequisites (one-time)

1. **Upgrade to the Blaze plan.** Firebase Console → your project → gear icon
   → Usage and billing → Modify plan → Blaze (pay-as-you-go). You need a
   billing method on file, but there's a generous free tier — normal admin
   panel usage (a handful of user creations/resets a month) won't cost
   anything in practice.
2. **Install the Firebase CLI**, if you don't already have it:
   ```
   npm install -g firebase-tools
   firebase login
   ```

## First-time setup

From your project root (the folder that contains both your React app and
this `functions/` folder):

```bash
cd functions
npm install
cd ..
firebase use --add        # pick your Firebase project, give it any alias
```

If you don't already have a `firebase.json` at the project root, create one
with at least this:

```json
{
  "functions": {
    "source": "functions"
  }
}
```
(If you already have a `firebase.json` for Firestore rules/indexes, just add
the `"functions"` block to it.)

## Deploy

```bash
firebase deploy --only functions
```

That's it — this deploys independently of your Vercel app deploys. You'll
run this again any time `functions/index.js` changes, but not for ordinary
React/UI changes.

## Verifying it worked

In the Firebase Console → Functions, you should see `createUser`,
`resetPassword`, and `deleteUser` listed as callable functions. Then in the
app: Admin tab → Add User → fill in a User ID/name/password → it should
create the account without kicking you out of your own session.

## If something goes wrong

```bash
firebase functions:log
```
shows the server-side error for the most recent calls — most issues will be
a permission check failing (caller's Firestore `users/{uid}` doc doesn't
have `role: "admin"`) or a duplicate User ID.

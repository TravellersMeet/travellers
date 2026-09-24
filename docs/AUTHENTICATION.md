# Authentication Flow

`src/lib/auth.ts` is the single source of truth for authentication: it configures
[NextAuth](https://authjs.dev/) with a custom Prisma adapter, three providers, and
the callbacks that shape the session every request sees. This doc walks through
how a sign-in actually flows through that file, for anyone extending or
debugging it. For the higher-level architecture (where auth fits among the
other API routes), see [ARCHITECTURE.md](ARCHITECTURE.md#authentication-and-session-flow).

## Providers

Three providers are configured, and any of them can complete a sign-in:

- **`Credentials`** — email + password. `authorize()` validates the payload
  with `credentialsSchema` (see `src/lib/validation/auth.ts`), looks up the
  user, rejects unverified emails, and compares the password against
  `passwordHash` with `bcryptjs`. Returns `null` on any failure so NextAuth
  reports a generic "invalid credentials" error rather than leaking which
  check failed.
- **`GoogleProvider`** / **`AppleProvider`** — standard OAuth providers, keyed
  off `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and
  `APPLE_CLIENT_ID`/`APPLE_CLIENT_SECRET`.

## The custom adapter

`PrismaAdapter(prisma)` is used as-is for everything except user creation.
`adapter.createUser` is overridden so that OAuth sign-ups land with the same
shape as credential sign-ups: `passwordHash: null` (OAuth users never get a
local password) and `emailVerified: true` (the OAuth provider already proved
the email). Without this override, the default adapter would create the user
with whatever partial shape the provider profile gives it, which the rest of
the app doesn't expect.

## Session strategy: JWT, not database sessions

`session: { strategy: "jwt" }` means the session lives entirely in a signed
cookie, not in the `Session` table. That makes these two callbacks the only
place session data is ever assembled:

- **`callbacks.jwt({ token, user, account })`** — runs on sign-in (when `user`
  is defined) and on every subsequent request (when it isn't). On sign-in it
  copies `id` and `role` from the freshly-authenticated `user` onto the
  token, which is what makes them available later. Because this callback
  fires on every request, keep any work added here cheap — it's on the hot
  path for authenticated traffic.
- **`callbacks.session({ session, token })`** — runs whenever `auth()` or
  `useSession()` is called, and copies `id`/`role` back off the token onto
  `session.user`. Route handlers reading `session.user.id` /
  `session.user.role` (see `auth()` usage throughout `src/app/api/**`) are
  reading exactly what this callback puts there.

`role` isn't part of NextAuth's default `User`/`Session`/`JWT` types, which is
why both callbacks reach for it with a `@ts-ignore` rather than a typed
field — see [#420](https://github.com/TravellersMeet/travellers/issues/420)
for tightening this up properly.

## Events and logging

`events.signIn` fires after a successful sign-in — currently a no-op hook
point for anything that should react to a login (analytics, audit logging,
etc.) without being in the critical callback path above.

`logger` routes NextAuth's own internal errors/warnings through the app's
`console.error`/`console.warn` rather than NextAuth's default logger. This is
about NextAuth's internal diagnostics, not app-level auth events — it does
not log user credentials, tokens, or session contents.

> **Note:** earlier revisions of this file also logged the full `user`,
> `account`, and `token` objects (including the signed JWT payload) on every
> sign-in and every `jwt` callback invocation. That's sensitive enough to be
> worth calling out explicitly here even though it's now removed — if you're
> adding temporary debug logging while working on this file, keep it out of
> `callbacks.jwt` and `events.signIn`, and never commit it.

## Custom pages

`pages.signIn` and `pages.error` point at the app's own `/signin` and
`/auth/error` routes instead of NextAuth's default UI, so sign-in errors and
the sign-in form match the rest of the app's design.

## Adding a new provider or claim

1. Add the provider to the `providers` array (or a new field to the
   `Credentials` `authorize()` return value).
2. Thread it through `callbacks.jwt` (token) and `callbacks.session`
   (session) — a value that isn't copied in both callbacks won't be visible
   to `auth()` callers even if the provider returns it.
3. If it's a new claim beyond NextAuth's built-in types, extend the module
   augmentation for `next-auth` (or add a scoped `@ts-ignore` matching the
   existing `role` pattern) rather than casting the whole object with `as any`.

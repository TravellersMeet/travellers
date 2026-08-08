# API Reference

This document summarizes the backend endpoints implemented in the current codebase.

## Base URL

- Local development: `http://localhost:3000/api`
- Production: use your deployed application domain and append `/api`

## Authentication model

Most protected endpoints require an authenticated NextAuth session cookie.

The authentication flow implemented by the app is:

1. `POST /api/auth/signup`
2. `POST /api/auth/verify-otp`
3. `POST /api/auth/[...nextauth]` for sign-in
4. Use the session cookie on later API requests

## Auth endpoints

### `POST /api/auth/signup`

Create a new account and send a one-time OTP to the user's email.

Request body:

```json
{
  "name": "Asha Sharma",
  "email": "asha@example.com",
  "password": "securepassword"
}
```

Typical responses:

- `200 OK` with `ok: true`, `userId`, and a success message
- `400 Bad Request` when the email already exists
- `207 Multi-Status` if the account is created but the OTP email could not be sent

### `POST /api/auth/verify-otp`

Verify the email with the 6-digit OTP.

Request body:

```json
{
  "email": "asha@example.com",
  "otp": "123456"
}
```

### `POST /api/auth/resend-otp`

Generate and resend a fresh OTP for an unverified account.

Request body:

```json
{
  "email": "asha@example.com"
}
```

### `POST /api/auth/forgot-password`

Request a password reset email.

Request body:

```json
{
  "email": "asha@example.com"
}
```

### `POST /api/auth/reset-password`

Reset the password using a valid reset token.

Request body:

```json
{
  "token": "<reset-token>",
  "password": "newSecurePassword"
}
```

### `PUT /api/auth/change-password`

Change the currently authenticated user's password.

Request body:

```json
{
  "currentPassword": "oldPassword",
  "newPassword": "newStrongPassword"
}
```

### `GET /api/auth/[...nextauth]` and `POST /api/auth/[...nextauth]`

NextAuth-owned credential authentication route. This handles sign-in and callback operations.

## User profile endpoints

### `PATCH /api/user/profile`

Update profile fields for the current authenticated user.

Request body:

```json
{
  "name": "Updated Name",
  "bio": "Travel enthusiast",
  "location": "Delhi"
}
```

## Ticket endpoints

### `POST /api/tickets`

Create a travel ticket submission for the current user.

Request body:

```json
{
  "destination": "Paris",
  "departureDate": "2026-08-02",
  "file": "<File object>"
}
```

Notes:

- The route currently stores the ticket record in Prisma.
- The file upload itself is still a placeholder and is not yet persisted to a real object storage bucket.

### `GET /api/tickets`

Return the current user's tickets, ordered from newest to oldest.

## Admin ticket endpoints

All admin endpoints require the current user to have `ADMIN` role.

### `GET /api/admin/tickets`

List tickets for admin review.

Optional query parameter:

- `status=VERIFIED`
- `status=REJECTED`
- `status=PENDING`

### `GET /api/admin/tickets/[id]`

Fetch a single ticket record for inspection.

### `PATCH /api/admin/tickets/[id]`

Update a ticket status to `VERIFIED` or `REJECTED`.

Request body:

```json
{
  "status": "VERIFIED"
}
```

## Route endpoints

### `GET /api/routes`

List all route records owned by the authenticated user.

### `POST /api/routes`

Create a new route, or update an existing route when the request includes an `id`.

Request body shape:

```json
{
  "id": "optional-existing-route-id",
  "origin": { "lat": 28.6139, "lng": 77.2090 },
  "destination": { "lat": 48.8566, "lng": 2.3522 },
  "waypoints": [
    {
      "location": { "lat": 41.0082, "lng": 28.9784 },
      "stopover": true,
      "name": "Istanbul"
    }
  ],
  "originName": "New Delhi",
  "destinationName": "Paris",
  "distance": 12345,
  "duration": 3600,
  "encodedPolyline": "<polyline-string>",
  "tripName": "Summer Trip",
  "notes": "Optional notes"
}
```

### `GET /api/routes/[id]`

Fetch a single route belonging to the authenticated user.

### `DELETE /api/routes?id=<routeId>`

Delete a saved route owned by the authenticated user.

## Match discovery endpoint

### `GET /api/matches?destination=<name>&date=<YYYY-MM-DD>`

Find verified travellers traveling to the same destination within a ±3 day date window.

Example:

```http
GET /api/matches?destination=Paris&date=2026-08-02
```

Response:

```json
{
  "matches": [],
  "cached": false
}
```

## Messaging endpoints

### `GET /api/messages?conversationId=<id>`

Return a page of the conversation transcript. The caller must be a participant,
otherwise the endpoint responds `404`.

Query parameters:

| Name | Default | Notes |
| --- | --- | --- |
| `conversationId` | — | Required. |
| `limit` | `20` | Capped at `100`. |
| `cursor` | — | Opaque cursor from a previous `pagination.nextCursor`. |

Response:

```json
{
  "items": [{ "id": "msg-3", "text": "See you at the gate", "createdAt": "..." }],
  "pagination": {
    "limit": 20,
    "nextCursor": "eyJ2ZXJzaW9uIjoxLCJ0aW1lc3RhbXAiOiIuLi4iLCJpZCI6Im1zZy0yIn0",
    "hasMore": true
  },
  "messages": [{ "id": "msg-1", "text": "Landing at 6", "createdAt": "..." }]
}
```

Two orderings are returned deliberately:

- `items` is newest-first, matching the query order, so `pagination.nextCursor`
  lines up with the last element.
- `messages` is the same page re-sorted oldest-first, which is the order a chat
  transcript is rendered in. Pass `pagination.nextCursor` back as `cursor` to
  walk further into the past and prepend the result.

`400` is returned for a malformed `limit` or `cursor`.

### `POST /api/messages`

Send a message to a conversation the caller belongs to. Either `text` or
`routeId` must be present.

Request body:

```json
{
  "conversationId": "conv-1",
  "text": "Booked the 7am bus",
  "routeId": "route-1"
}
```

A `routeId` must belong to the sender; otherwise the endpoint responds `403`.
On success the created message is broadcast over Pusher to the conversation
channel and to each participant's personal channel.

### `GET /api/conversations`

List the caller's conversations, most recently updated first, each with the
other participant and the latest message for the sidebar.

## AI chat endpoint

### `POST /api/chat`

Send a natural-language message to the Gemini-based TravelBox AI assistant.

Request body:

```json
{
  "message": "How do I upload my ticket?"
}
```

Response:

```json
{
  "reply": "You can upload your ticket from the dashboard..."
}
```

Important:

- This endpoint requires `GEMINI_API_KEY` to be configured.
- It validates a short message payload and returns a single assistant reply.

## Current implementation notes

These endpoints are the most important ones in the current app:

- Authentication and OTP-based signup
- Ticket upload and list retrieval
- Admin verification workflow
- Saved route CRUD
- Match discovery for verified travellers
- Gemini-powered chat assistance

If you are adding or changing endpoints, keep this document updated so the README and backend behavior stay aligned.

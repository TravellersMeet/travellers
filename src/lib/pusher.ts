import Pusher from "pusher";

const appId = process.env.PUSHER_APP_ID;
const key = process.env.PUSHER_KEY;
const secret = process.env.PUSHER_SECRET;
const cluster = process.env.PUSHER_CLUSTER;

const isConfigured = !!(appId && key && secret && cluster);

export const pusherServer = isConfigured
  ? new Pusher({
      appId: appId!,
      key: key!,
      secret: secret!,
      cluster: cluster!,
      useTLS: true,
    })
  : null;

if (!isConfigured) {
  console.warn(
    "⚠️ Pusher environment variables (PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER) are not fully configured. Real-time updates will be logged to the console but not delivered."
  );
}

/**
 * Whether the credential-free mock authorisation response is permitted.
 *
 * It exists so the test suite and a bare `npm run dev` can exercise the
 * subscribe path without Pusher credentials. It must never be reachable in a
 * deployed environment: a production box that loses `PUSHER_SECRET` would
 * otherwise answer every subscribe with `200` and a signature Pusher rejects,
 * so realtime silently stops working while the client believes it authorised.
 *
 * `PUSHER_ALLOW_MOCK_AUTH=true` is the explicit opt-in for a staging box that
 * genuinely wants the mock.
 */
export function isMockAuthAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.PUSHER_ALLOW_MOCK_AUTH === "true") {
    return true;
  }

  return (
    env.NODE_ENV === "test" ||
    env.NODE_ENV === "development"
  );
}

export async function triggerPusher(channel: string, event: string, data: any) {
  if (pusherServer) {
    try {
      await pusherServer.trigger(channel, event, data);
    } catch (error) {
      console.error(`Error triggering Pusher event '${event}' on channel '${channel}':`, error);
    }
  } else {
    console.log(`[Pusher Mock Trigger] Channel: ${channel}, Event: ${event}, Data:`, data);
  }
}

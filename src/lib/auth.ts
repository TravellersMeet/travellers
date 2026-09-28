import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import { compare } from "bcryptjs";
import { credentialsSchema } from "@/lib/validation/auth";

const adapter = PrismaAdapter(prisma) as any;

/**
 * Override the default adapter's user creation so OAuth sign-ups (Google,
 * Apple) land with the same shape credential sign-ups have:
 * - `passwordHash: null`, since OAuth users never set a local password.
 * - `emailVerified: true`, since the OAuth provider already verified it.
 *
 * Without this, the default `PrismaAdapter` creates the user straight from
 * the provider profile, which doesn't set either field the rest of the app
 * (e.g. the Credentials provider's `authorize()` below) relies on.
 */
adapter.createUser = async (data: any) => {
  return prisma.user.create({
    data: {
      name: data.name ?? "",
      email: data.email,
      image: data.image,
      passwordHash: null,
      emailVerified: true,
    },
  });
};

// See docs/AUTHENTICATION.md for a full walkthrough of this config.
export const { auth, signIn, signOut, handlers } = NextAuth({
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  adapter,
  providers: [
    GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
}),
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials ?? {});
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        // Check if email is verified
        if (!user.emailVerified) {
          throw new Error("Please verify your email before signing in");
        }

        if (!user.passwordHash) return null;
        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role
        } as any;
      },
    }),
  ],
  // Sessions are signed JWTs in a cookie, not rows in the Session table —
  // the jwt/session callbacks below are the only place session data is
  // assembled.
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
  /**
   * Runs on sign-in (when `user` is set) and on every subsequent
   * authenticated request (when it isn't). On sign-in, copy the fields the
   * rest of the app needs off the freshly-authenticated `user` and onto the
   * token — this callback is on the hot path for all authenticated traffic,
   * so keep it cheap.
   */
  async jwt({ token, user, account }) {
    if (user) {
      token.id = user.id;
      // `role` isn't part of NextAuth's built-in User/JWT types — see #420.
      // @ts-ignore
      token.role = user.role;
    }

    return token;
  },
    /**
     * Runs whenever `auth()` / `useSession()` is called. Copies `id`/`role`
     * off the JWT (set above) onto `session.user`, which is what route
     * handlers read via `session.user.id` / `session.user.role`.
     */
    async session({ session, token }) {
      if (session?.user) {
        session.user.id = token.id as string;
        // @ts-ignore - role not in default session type
        session.user.role = token.role;
      }
      return session;
    },
  },
  events: {
  // Hook point for anything that should react to a successful sign-in
  // (analytics, audit logging, etc.) without living in the jwt callback.
  async signIn(message) {
    void message;
  },
},

// Routes NextAuth's own internal diagnostics (not user credentials or
// session contents) through the app's logger.
logger: {
  error(error: Error) {
    console.error("NEXTAUTH ERROR:", error);
  },
  warn(code: string) {
    console.warn("NEXTAUTH WARNING:", code);
  },
},
  // Use the app's own sign-in/error pages instead of NextAuth's default UI.
  pages: {
    signIn: '/signin',
    error: '/auth/error',
  },
});

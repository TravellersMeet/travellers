function getEnvNumber(key: string, fallback: number): number {
  const value = process.env[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RATE_LIMIT_CONFIG = {
  auth: {
    signin: {
      limit: getEnvNumber("RATE_LIMIT_AUTH_SIGNIN_LIMIT", 10),
      windowSeconds: getEnvNumber("RATE_LIMIT_AUTH_SIGNIN_WINDOW_SECONDS", 600), // 10 minutes
    },
    signup: {
      limit: getEnvNumber("RATE_LIMIT_AUTH_SIGNUP_LIMIT", 5),
      windowSeconds: getEnvNumber("RATE_LIMIT_AUTH_SIGNUP_WINDOW_SECONDS", 3600), // 1 hour
    },
    forgotPassword: {
      limit: getEnvNumber("RATE_LIMIT_AUTH_FORGOT_PASSWORD_LIMIT", 3),
      windowSeconds: getEnvNumber("RATE_LIMIT_AUTH_FORGOT_PASSWORD_WINDOW_SECONDS", 900), // 15 minutes
    },
    verifyOtp: {
      limit: getEnvNumber("RATE_LIMIT_AUTH_VERIFY_OTP_LIMIT", 10),
      windowSeconds: getEnvNumber("RATE_LIMIT_AUTH_VERIFY_OTP_WINDOW_SECONDS", 600), // 10 minutes
    },
    resendOtp: {
      limit: getEnvNumber("RATE_LIMIT_AUTH_RESEND_OTP_LIMIT", 3),
      windowSeconds: getEnvNumber("RATE_LIMIT_AUTH_RESEND_OTP_WINDOW_SECONDS", 600), // 10 minutes
    },
  },
} as const;

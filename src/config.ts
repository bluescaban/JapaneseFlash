// Expo automatically injects EXPO_PUBLIC_* variables from .env at Metro start time.
// No plugins or babel transforms required.
export const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '';

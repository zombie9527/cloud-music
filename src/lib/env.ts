function requireEnvironmentVariableValue(variableName: string, variableValue: string | undefined): string {

  if (!variableValue) {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }

  return variableValue;
}

export const environment = {
  get supabaseUrl() {
    // NEXT_PUBLIC_ variables must be referenced directly so Next.js can embed
    // them in browser bundles. Dynamic process.env[variableName] access works
    // on the server but is undefined in client components.
    return requireEnvironmentVariableValue(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get supabasePublishableKey() {
    return requireEnvironmentVariableValue(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get supabaseStorageBucketName() {
    return process.env.SUPABASE_STORAGE_BUCKET ?? "music";
  },
};

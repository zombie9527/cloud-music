function requireEnvironmentVariable(variableName: string): string {
  const variableValue = process.env[variableName];

  if (!variableValue) {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }

  return variableValue;
}

export const environment = {
  get supabaseUrl() {
    return requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabasePublishableKey() {
    return requireEnvironmentVariable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  },
  get supabaseStorageBucketName() {
    return process.env.SUPABASE_STORAGE_BUCKET ?? "music";
  },
};

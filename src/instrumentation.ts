export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { accessModeSummary } = await import("./lib/auth");
    console.log(accessModeSummary());

    const { startAutoIngest } = await import("./lib/auto-ingest");
    startAutoIngest();

    const { startLiveTracker } = await import("./lib/live-tracker");
    startLiveTracker();
  }
}

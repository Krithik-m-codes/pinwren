export function deploymentMode(): "selfhost" | "cloud" {
  const mode = process.env.PINWREN_MODE ?? "selfhost";
  if (mode !== "selfhost" && mode !== "cloud") throw new Error("Invalid PINWREN_MODE: use selfhost or cloud");
  return mode;
}

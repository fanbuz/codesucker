export function unlockStep(maxUnlockedStep: number, nextStep: number): number {
  return Math.max(maxUnlockedStep, nextStep);
}

export function canVisitStep(step: number, loaded: boolean, maxUnlockedStep: number): boolean {
  return step === 1 || (loaded && step <= maxUnlockedStep);
}

const METERS_PER_KILOMETER = 1000;
const METERS_PER_MILE = 1609.344;

export interface DistanceBreakdown {
  meters: number;
  kilometers: number;
  miles: number;
}

/** Mechanical unit conversion for response DTOs — km/miles rounded to 2 decimals, `meters` kept at source precision. */
export function formatDistance(meters: number): DistanceBreakdown {
  return {
    meters,
    kilometers: Math.round((meters / METERS_PER_KILOMETER) * 100) / 100,
    miles: Math.round((meters / METERS_PER_MILE) * 100) / 100,
  };
}

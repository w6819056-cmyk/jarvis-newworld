export type TravelMode = 'drive' | 'ride' | 'walk';

export type NearbyPlace = {
  name: string;
  address: string;
  distanceMeters: number;
};

export type NearbySearchResult = {
  places: NearbyPlace[];
};

export type RoutePlanResult =
  | {
      status: 'planned';
      origin: string;
      destination: string;
      mode: TravelMode;
      distanceMeters: number;
      durationSeconds: number;
    }
  | {
      status: 'needsSelection';
      destination: string;
      candidates: { name: string; address: string }[];
    };

export function createPlannedRouteResult(
  result: Omit<Extract<RoutePlanResult, { status: 'planned' }>, 'status'>
): RoutePlanResult {
  return { status: 'planned', ...result };
}

export type MapCommand =
  | { type: 'getCurrentLocation'; payload: Record<string, never> }
  | { type: 'searchNearby'; payload: { category: string } }
  | { type: 'planRoute'; payload: { destination: string; mode: TravelMode } };

export type MapCommandEnvelope = MapCommand & { id: number };

export type MapResponseEnvelope = {
  id: number;
  success: boolean;
  result?: unknown;
  error?: string;
};

export interface MapController {
  getCurrentLocation(): Promise<{ latitude: number; longitude: number; address: string }>;
  searchNearby(args: { category: string }): Promise<NearbySearchResult>;
  planRoute(args: { destination: string; mode: TravelMode }): Promise<RoutePlanResult>;
}

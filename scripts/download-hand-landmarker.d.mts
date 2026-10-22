export const HAND_MODEL_URL: string;
export const HAND_MODEL_SIZE: number;
export const HAND_MODEL_SHA256: string;
export function verifyAsset(bytes: Uint8Array, expectedSize: number, expectedSha256: string): boolean;
export function verifyHandModel(bytes: Uint8Array): boolean;
export function downloadHandModel(destination?: string): Promise<void>;

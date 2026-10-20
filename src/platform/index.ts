import type { PlatformAdapter } from '../core/types.js';
import { darwin } from './darwin.js';

const ADAPTERS: Partial<Record<NodeJS.Platform, PlatformAdapter>> = {
  darwin,
};

export function getPlatform(platform: NodeJS.Platform = process.platform): PlatformAdapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`Portlight does not support ${platform} yet.`);
  return adapter;
}

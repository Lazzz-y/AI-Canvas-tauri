import { describe, expect, it } from 'vitest';
import { normalizeSeedreamSize } from '../../src/services/ai/helpers';
import { getImageCapability } from '../../src/services/ai/mediaModelCapabilities';

describe('image model capability resolution', () => {
  it('resolves the versioned Volcengine Seedream 5.0 Pro model', () => {
    const capability = getImageCapability('volcengine/doubao-seedream-5-0-pro-260628');

    expect(capability).toMatchObject({
      modelId: 'doubao-seedream-5-0-pro',
      resolutions: ['1K', '1.5K', '2K'],
      defaultResolution: '2K',
      defaultRatio: 'auto',
    });
    expect(capability?.ratios).toContain('auto');
    expect(capability?.dimensionPresets?.['2K']?.['16:9']).toEqual([2816, 1584]);
  });

  it.each([
    ['volcengine/doubao-seedream-5-0-lite-260128', ['2K', '3K', '4K']],
    ['volcengine/doubao-seedream-4-5-251128', ['2K', '4K']],
    ['volcengine/doubao-seedream-4-0-250828', ['1K', '2K', '4K']],
  ])('resolves versioned model %s', (model, resolutions) => {
    expect(getImageCapability(model)?.resolutions).toEqual(resolutions);
  });

  it('keeps Seedream 5.0 Pro 1.5K instead of degrading it', () => {
    expect(normalizeSeedreamSize('doubao-seedream-5-0-pro-260628', '1.5K')).toBe('1.5K');
  });
});

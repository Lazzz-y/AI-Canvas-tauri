import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import VideoCapabilityEditor from '../../src/components/settings/providerConnection/VideoCapabilityEditor';
import {
  assertProviderModelsVideoCapabilities,
  createEditableVideoCapability,
  keepDeclaredVideoCapabilityDefault,
} from '../../src/components/settings/providerConnection/providerConnectionModels';
import type { ProviderModelSelection } from '../../src/types';
import type { VideoModelCapability } from '../../src/types/aiTypes';

describe('provider video capability editor normalization', () => {
  it('preserves partial capability fields without inventing defaults', () => {
    const capability: VideoModelCapability = {
      ratios: ['7:4'],
      resolutions: ['2K'],
      frameRates: [30],
      durations: [10, 15],
      supportsAudio: true,
      inputConstraints: { promptMinCharacters: 3 },
    };

    const editable = createEditableVideoCapability(capability);

    expect(editable).toEqual(capability);
    expect(editable).not.toHaveProperty('defaultRatio');
    expect(editable).not.toHaveProperty('defaultResolution');
    expect(editable).not.toHaveProperty('defaultFrameRate');
    expect(editable).not.toHaveProperty('defaultDuration');
    expect(editable).not.toHaveProperty('minDuration');
    expect(editable).not.toHaveProperty('maxDuration');
  });

  it('keeps an empty capability empty instead of applying Seedance presets', () => {
    expect(createEditableVideoCapability()).toEqual({});
  });

  it('clones nested operation and input-mode overrides before editing', () => {
    const source: VideoModelCapability = {
      ratios: ['adaptive'],
      inputModeCapabilities: { keyframe: { ratios: ['adaptive'] } },
      operationCapabilities: { 'video-to-video': { automaticDurationOnly: true } },
      automaticDurationValue: -1,
    };
    const editable = createEditableVideoCapability(source);
    editable.inputModeCapabilities!.keyframe!.ratios!.push('test-only');

    expect(source.inputModeCapabilities?.keyframe?.ratios).toEqual(['adaptive']);
  });

  it('shows all explicit Seedance version and transport templates', () => {
    const html = renderToStaticMarkup(createElement(VideoCapabilityEditor, {
      model: {
        id: 'custom-video',
        name: 'Custom Video',
        category: 'video',
        provider: 'custom-provider',
      },
      onChange: () => undefined,
      onApplySeedanceTemplate: () => undefined,
      onClose: () => undefined,
    }));

    expect(html).toContain('Seedance 快速适配');
    expect(html).toContain('Seedance 2.5 · 火山原生');
    expect(html).toContain('Seedance 2.0 Mini · APIMart 兼容');
    expect(html).toContain('不会根据模型名称自动猜测');
  });

  it('does not turn the first allowed value into an undeclared default', () => {
    expect(keepDeclaredVideoCapabilityDefault(undefined, ['2K', '4K'])).toBeUndefined();
    expect(keepDeclaredVideoCapabilityDefault('2K', ['2K', '4K'])).toBe('2K');
    expect(keepDeclaredVideoCapabilityDefault('2K', ['4K'])).toBeUndefined();
    expect(keepDeclaredVideoCapabilityDefault(undefined, [24, 30])).toBeUndefined();
  });

  it('validates edited capabilities before save while allowing documented long durations', () => {
    const model = (videoCapability: VideoModelCapability): ProviderModelSelection => ({
      id: 'long-video',
      name: 'Long Video',
      category: 'video',
      provider: 'custom-long-video',
      videoCapability,
    });

    expect(() => assertProviderModelsVideoCapabilities([
      model({ minDuration: 60, maxDuration: 120, defaultDuration: 90 }),
    ])).not.toThrow();
    expect(() => assertProviderModelsVideoCapabilities([
      model({ minDuration: 120, maxDuration: 60 }),
    ])).toThrow('minDuration 不能大于 maxDuration');
  });
});

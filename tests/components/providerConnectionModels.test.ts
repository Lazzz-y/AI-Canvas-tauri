import { describe, expect, it } from 'vitest';
import { materializeLegacyImageProtocolDefault } from '../../src/components/settings/providerConnection/providerConnectionModels';

describe('legacy connection image protocol', () => {
  it('copies a saved connection default only to selected image models without overrides', () => {
    const models = materializeLegacyImageProtocolDefault([
      { id: 'image-a', name: '图片 A', category: 'image', provider: 'gateway' },
      { id: 'image-b', name: '图片 B', category: 'image', provider: 'gateway',
        executionProfile: { preset: 'openai-gpt-image' },
        imageReferenceRequestMode: 'edits-multipart' },
      { id: 'text-a', name: '文本 A', category: 'text', provider: 'gateway' },
    ], {
      imageProtocolDefault: { preset: 'gpt-image-gateway-json' },
      imageReferenceRequestModeDefault: 'generation-json-image-data-urls',
    });
    expect(models[0]).toMatchObject({
      executionProfile: { preset: 'gpt-image-gateway-json' },
      imageReferenceRequestMode: 'generation-json-image-data-urls',
    });
    expect(models[1]).toMatchObject({
      executionProfile: { preset: 'openai-gpt-image' },
      imageReferenceRequestMode: 'edits-multipart',
    });
    expect(models[2].executionProfile).toBeUndefined();
  });
});

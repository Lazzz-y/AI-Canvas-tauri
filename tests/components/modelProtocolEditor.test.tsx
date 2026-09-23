import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ModelProtocolEditor from '../../src/components/settings/ModelProtocolEditor';
import { getDefaultCustomProtocol } from '../../src/services/ai/modelProtocol';
import type { ProviderModelSelection } from '../../src/types';

function renderEditor(model: ProviderModelSelection): string {
  return renderToStaticMarkup(createElement(ModelProtocolEditor, {
    model, apiKey: '', baseUrl: 'https://gateway.example/v1',
    onChange: () => {}, onImageReferenceRequestModeChange: () => {},
    onValidityChange: () => {}, onClose: () => {},
  }));
}

describe('model protocol editor', () => {
  it.each(['image', 'text'] as const)('shows only JSON editing for a custom %s protocol', (category) => {
    const html = renderEditor({
      id: `${category}-model`, name: `${category} model`, category, provider: 'gateway',
      executionProfile: { preset: 'custom', protocol: getDefaultCustomProtocol(category) },
    });
    expect(html).toContain('声明式协议 JSON');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('执行模式');
  });

  it('keeps a named image preset compact inside the model settings', () => {
    const html = renderEditor({
      id: 'gateway-image', name: 'GPT Image', category: 'image', provider: 'gateway',
      executionProfile: { preset: 'gpt-image-gateway-json' },
    });
    expect(html).toContain('GPT Image');
    expect(html).not.toContain('声明式协议 JSON');
    expect(html).not.toContain('执行模式');
  });

  it('offers the existing Anthropic and Gemini adapters for a text model', () => {
    const html = renderEditor({
      id: 'chat-model', name: 'Chat model', category: 'text', provider: 'gateway',
      executionProfile: { preset: 'anthropic-chat' },
    });
    expect(html).toContain('Anthropic Messages');
    expect(html).toContain('Google Gemini generateContent');
    expect(html).not.toContain('声明式协议 JSON');
  });
});

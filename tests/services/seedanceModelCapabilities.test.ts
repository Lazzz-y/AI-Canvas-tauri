import { describe, expect, it } from 'vitest';
import {
  createSeedanceQuickAdaptTemplate,
  getOfficialSeedanceCapability,
  SEEDANCE_QUICK_ADAPT_OPTIONS,
} from '../../src/services/ai/seedanceModelCapabilities';

describe('Seedance capability templates', () => {
  it('declares the official 2.0 resolution tiers and adaptive ratio support', () => {
    expect(getOfficialSeedanceCapability('2.0-standard')).toMatchObject({
      resolutions: ['480p', '720p', '1080p', '4k'],
      ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive'],
      minDuration: 4,
      maxDuration: 15,
    });
    expect(getOfficialSeedanceCapability('2.0-fast').resolutions).toEqual(['480p', '720p']);
    expect(getOfficialSeedanceCapability('2.0-mini').resolutions).toEqual(['480p', '720p']);
  });

  it('declares Seedance 2.5 automatic duration and operation-specific restrictions', () => {
    expect(getOfficialSeedanceCapability('2.5')).toMatchObject({
      resolutions: ['480p', '720p', '1080p'],
      defaultRatio: 'adaptive',
      automaticDurationValue: -1,
      operationCapabilities: {
        'video-to-video': {
          ratios: ['adaptive'],
          defaultRatio: 'adaptive',
          automaticDurationOnly: true,
        },
      },
      inputModeCapabilities: {
        keyframe: { ratios: ['adaptive'], defaultRatio: 'adaptive' },
      },
    });
  });

  it('builds a Volcano Engine native protocol with typed content and official polling', () => {
    const template = createSeedanceQuickAdaptTemplate('2.5', 'volcengine');
    expect(template.executionProfile).toMatchObject({
      preset: 'custom',
      protocol: {
        version: 2,
        mode: 'async',
        submit: {
          path: '/contents/generations/tasks',
          body: {
            content: '{{seedanceContent}}',
            ratio: '{{seedanceRatio}}',
            duration: '{{seedanceDuration}}',
          },
        },
        response: { taskIdPath: 'id' },
        poll: {
          path: '/contents/generations/tasks/{{submit.id}}',
          response: { statusPath: 'status', result: { urlPath: 'content.video_url' } },
        },
      },
    });
  });

  it('keeps APIMart transport limits and field names as a provider overlay', () => {
    const template = createSeedanceQuickAdaptTemplate('2.5', 'apimart');
    expect(template.capability).toMatchObject({
      resolutions: ['480p', '720p'],
      defaultDuration: 5,
    });
    expect(template.capability).not.toHaveProperty('automaticDurationValue');
    expect(template.executionProfile.protocol?.submit).toMatchObject({
      path: '/videos/generations',
      body: {
        size: '{{seedanceRatio}}',
        image_with_roles: '{{imageWithRoles}}',
      },
    });
    const protocol = template.executionProfile.protocol;
    expect(protocol && 'response' in protocol ? protocol.response : undefined).toMatchObject({
      taskIdPath: 'data.0.task_id',
    });
  });

  it('returns independent clones and exposes all eight explicit choices', () => {
    const first = createSeedanceQuickAdaptTemplate('2.5', 'volcengine');
    const second = createSeedanceQuickAdaptTemplate('2.5', 'volcengine');
    first.capability.ratios?.push('test-only');
    expect(second.capability.ratios).not.toContain('test-only');
    expect(SEEDANCE_QUICK_ADAPT_OPTIONS).toHaveLength(8);
  });
});

import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { readAppSecret, writeAppSecret } from '../../services/providerSecretService';
import type { ApiProviderConfig } from '../../types';

const ACCESS_KEY_REF = 'secret:provider/volcengine/asset-library/access-key';
const SECRET_KEY_REF = 'secret:provider/volcengine/asset-library/secret-key';

export default function VolcengineAssetLibrarySettings({ config, onChange, onPersist }: { config: ApiProviderConfig; onChange: (next: ApiProviderConfig) => void; onPersist?: (assetLibrary: NonNullable<ApiProviderConfig['assetLibrary']>) => Promise<void> }) {
  const provider = config;
  const library = provider?.assetLibrary;
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAppSecret(ACCESS_KEY_REF.slice('secret:'.length)), readAppSecret(SECRET_KEY_REF.slice('secret:'.length))])
      .then(([ak, sk]) => { if (!cancelled) { setAccessKeyId(ak || ''); setSecretAccessKey(sk || ''); } });
    return () => { cancelled = true; };
  }, [provider?.assetLibrary?.accessKeyIdRef, provider?.assetLibrary?.secretAccessKeyRef]);

  const patchLibrary = (patch: Record<string, unknown>) => onChange({ ...provider, assetLibrary: { ...library, enabled: library?.enabled ?? false, projectName: library?.projectName || 'default', ...patch } });

  const save = async () => {
    setMessage('');
    const accessStored = await writeAppSecret(ACCESS_KEY_REF.slice('secret:'.length), accessKeyId.trim());
    const secretStored = await writeAppSecret(SECRET_KEY_REF.slice('secret:'.length), secretAccessKey.trim());
    const nextLibrary = {
      accessKeyIdRef: ACCESS_KEY_REF,
      secretAccessKeyRef: SECRET_KEY_REF,
      enabled: true,
      projectName: library?.projectName || 'default',
      region: library?.region || 'cn-beijing',
    };
    patchLibrary(nextLibrary);
    if (onPersist) await onPersist(nextLibrary);
    setMessage(accessStored && secretStored ? '虚拟人像库配置已保存' : '当前环境无法持久化 AK/SK，仅本次会话有效');
  };

  return (
    <section className="mt-3 rounded border border-canvas-border bg-canvas-surface p-3" aria-label="火山方舟虚拟人像库配置">
      <div className="flex items-start gap-2">
        <Icon icon="mdi:account-box-multiple-outline" width="18" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <strong className="block">虚拟人像库（可选）</strong>
          <p className="mt-1 text-xs text-canvas-text-secondary">用于素材资产组合与个人素材管理，不复用上方模型 API Key。</p>
        </div>
        <label className="flex items-center gap-1 text-xs text-canvas-text-secondary">
          <input type="checkbox" checked={library?.enabled ?? false} onChange={(event) => patchLibrary({ enabled: event.target.checked })} />
          启用
        </label>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-canvas-text-secondary">Access Key（AK）<input className="ui-input mt-1 w-full" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} placeholder="火山引擎访问密钥 AK" autoComplete="off" /></label>
        <label className="text-xs text-canvas-text-secondary">Secret Key（SK）<input className="ui-input mt-1 w-full" type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} placeholder="火山引擎访问密钥 SK" autoComplete="new-password" /></label>
        <label className="text-xs text-canvas-text-secondary">项目名称<input className="ui-input mt-1 w-full" value={library?.projectName ?? 'default'} onChange={(event) => patchLibrary({ projectName: event.target.value })} placeholder="default" /></label>
        <label className="text-xs text-canvas-text-secondary">区域<input className="ui-input mt-1 w-full" value={library?.region ?? 'cn-beijing'} onChange={(event) => patchLibrary({ region: event.target.value })} placeholder="cn-beijing" /></label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="ui-btn ui-btn--sm ui-btn--primary" disabled={!accessKeyId.trim() || !secretAccessKey.trim()} onClick={() => void save()}>保存虚拟人像库配置</button>
        {message && <span className="text-xs text-canvas-text-muted">{message}</span>}
      </div>
    </section>
  );
}

import { useState } from 'react';
import { Check, Copy, Cloud, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import { FormModal } from './dialogs';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCode } from '@/lib/personal-sync';
import type { PersonalSync } from '@/hooks/use-personal-sync';

export function SyncDialog({ sync, onClose }: { sync: PersonalSync; onClose: () => void }) {
  return (
    <FormModal title="随身餐簿" onClose={onClose}>
      <SyncSheet key={sync.session?.connection ?? 'disconnected'} sync={sync} />
    </FormModal>
  );
}

function SyncSheet({ sync }: { sync: PersonalSync }) {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const busy = sync.busy;
  const status = {
    off: '仅保存在本机',
    syncing: '正在同步',
    synced: '已同步',
    waiting: '等待同步',
    error: '同步待重试',
  }[sync.phase];
  async function copy() {
    if (!sync.session) return;
    try {
      await navigator.clipboard.writeText(formatCode(sync.session.code));
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError('可长按上方同步码，手动复制');
    }
  }
  return (
    <div className="sync-sheet">
      <p className="text-sm leading-6 text-muted-foreground">
        把个人用餐、窗口和昵称，带到另一台设备。
      </p>
      {sync.session ? (
        <>
          <div className="sync-status" role="status">
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Cloud className="size-4" />}
            <span>{status}</span>
            {sync.session.lastSynced > 0 && (
              <time className="ml-auto text-xs text-muted-foreground">
                {new Date(sync.session.lastSynced).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            )}
          </div>
          <label className="block text-xs text-muted-foreground" htmlFor="my-sync-code">
            我的同步码
          </label>
          <Input
            id="my-sync-code"
            className="sync-code"
            value={formatCode(sync.session.code)}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <Button className="w-full gap-2" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? '已复制' : '复制同步码'}
          </Button>
          {copyError && (
            <p className="text-xs text-muted-foreground" role="status">
              {copyError}
            </p>
          )}
          <p className="text-xs leading-6 text-muted-foreground">
            在另一台设备打开本站，点右上角云朵图标，输入此码。持有码的人可以查看和修改这份个人餐簿，请妥善保管。
          </p>
          <div className="sync-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void sync.refresh()}
              className="gap-2"
            >
              <RefreshCw className="size-4" />
              立即同步
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmLeave(true)}
              className="text-muted-foreground"
            >
              断开此设备
            </Button>
          </div>
          {confirmLeave && (
            <div className="sync-leave">
              <p className="text-sm leading-6">本机记录会保留，其他设备继续同步。</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                  取消
                </Button>
                <Button variant="outline" disabled={busy} onClick={sync.disconnect}>
                  确认断开
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <Button
            className="min-h-12 w-full gap-2"
            disabled={busy}
            onClick={() => void sync.connect()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Cloud className="size-4" />}
            获取我的同步码
          </Button>
          <div className="sync-divider">
            <span>已有同步码</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sync.connect(code);
            }}
            className="space-y-3"
          >
            <Input
              aria-label="输入同步码"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="粘贴另一台设备的同步码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="sync-code-entry"
              disabled={busy}
            />
            <Button
              type="submit"
              variant="outline"
              className="min-h-11 w-full gap-2"
              disabled={busy || !code.trim()}
            >
              <Link2 className="size-4" />
              连接这份餐簿
            </Button>
          </form>
          <p className="text-xs leading-6 text-muted-foreground">
            连接时合并两边的用餐记录，窗口和昵称采用已有餐簿的设置。草稿、定位和教程状态留在本机。
          </p>
        </>
      )}
      {sync.error && (
        <p role="alert" className="text-sm leading-6 text-destructive">
          {sync.error}
        </p>
      )}
    </div>
  );
}

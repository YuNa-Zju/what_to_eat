import { useState } from 'react';
import { Cloud } from 'lucide-react';
import { Button } from './ui/button';
import { SyncDialog } from './sync-dialog';
import { usePersonalSync } from '@/hooks/use-personal-sync';

// Background sync status belongs to this control; it does not rerender every page.
export function PersonalSyncButton() {
  const sync = usePersonalSync();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="sync-trigger min-h-11 min-w-11 text-muted-foreground"
        aria-label="个人餐簿同步"
        title="个人餐簿同步"
        data-tour="sync"
        onClick={() => setOpen(true)}
      >
        <Cloud className="size-[18px]" />
        {sync.session && <span className="sync-dot" data-status={sync.phase} />}
      </Button>
      {open && <SyncDialog sync={sync} onClose={() => setOpen(false)} />}
    </>
  );
}

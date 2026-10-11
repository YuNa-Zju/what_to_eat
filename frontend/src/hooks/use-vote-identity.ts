import { useSyncExternalStore } from 'react';
import { voteIdentity } from '../lib/vote-identity.ts';

export function useVoteIdentity() {
  return useSyncExternalStore(
    voteIdentity.subscribe,
    voteIdentity.getSnapshot,
    voteIdentity.getSnapshot,
  );
}

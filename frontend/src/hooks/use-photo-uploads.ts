import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { compressPhoto, uploadQueue } from '@/lib/photo-upload';
import { randomUUID } from '@/lib/uuid';

type Status = 'queued' | 'compressing' | 'uploading' | 'ready' | 'error';
interface PhotoUpload {
  id: string;
  file: File;
  url: string;
  status: Status;
  error?: string;
  blob?: Blob;
  expiresAt?: number;
  task?: Promise<string>;
  controller: AbortController;
}

function discard(id: string) {
  // Best effort; the server expires abandoned uploads if the page/network closes.
  void api(`/uploads/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

export function usePhotoUploads() {
  const jobs = useRef<PhotoUpload[]>([]);
  const queue = useRef(uploadQueue());
  const mounted = useRef(true);
  const [photos, setPhotos] = useState<PhotoUpload[]>([]);
  function refresh() {
    if (mounted.current) setPhotos(jobs.current.map((photo) => ({ ...photo })));
  }
  function start(photo: PhotoUpload) {
    photo.status = 'queued';
    photo.error = undefined;
    photo.task = queue
      .current(async () => {
        const signal = photo.controller.signal;
        signal.throwIfAborted();
        if (!photo.blob) {
          photo.status = 'compressing';
          refresh();
          photo.blob = await compressPhoto(photo.file, signal);
        }
        signal.throwIfAborted();
        photo.status = 'uploading';
        refresh();
        const uploaded = await api<{ id: string; expires_at: number }>(`/uploads/${photo.id}`, {
          method: 'PUT',
          body: photo.blob,
          headers: { 'Content-Type': photo.blob.type },
          signal,
        });
        if (signal.aborted) {
          discard(photo.id);
          signal.throwIfAborted();
        }
        photo.expiresAt = uploaded.expires_at;
        photo.status = 'ready';
        refresh();
        return uploaded.id;
      })
      .catch((error: unknown) => {
        if (!photo.controller.signal.aborted) {
          photo.status = 'error';
          photo.error = error instanceof Error ? error.message : '照片上传失败，请重试';
          refresh();
        }
        throw error;
      });
    // Background failures are shown on the photo; submit still observes rejection.
    void photo.task.catch(() => {});
    refresh();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const photo of jobs.current) {
        photo.controller.abort();
        URL.revokeObjectURL(photo.url);
        discard(photo.id);
      }
      jobs.current = [];
    };
  }, []);
  function add(files: File[]) {
    const added = files.map((file): PhotoUpload => ({
      id: randomUUID(),
      file,
      url: URL.createObjectURL(file),
      status: 'queued',
      controller: new AbortController(),
    }));
    jobs.current.push(...added);
    added.forEach(start);
  }
  function remove(id: string) {
    const photo = jobs.current.find((row) => row.id === id);
    if (!photo) return;
    jobs.current = jobs.current.filter((row) => row.id !== id);
    photo.controller.abort();
    URL.revokeObjectURL(photo.url);
    discard(id);
    refresh();
  }
  function retry(id: string) {
    const photo = jobs.current.find((row) => row.id === id);
    if (photo?.status === 'error') start(photo);
  }
  async function readyIds() {
    const current = [...jobs.current];
    for (const photo of current) {
      if (
        photo.status === 'error' ||
        (photo.status === 'ready' && (photo.expiresAt || 0) <= Date.now() + 60_000)
      ) {
        start(photo);
      }
    }
    return Promise.all(current.map((photo) => photo.task!));
  }
  return { photos, add, remove, retry, readyIds };
}

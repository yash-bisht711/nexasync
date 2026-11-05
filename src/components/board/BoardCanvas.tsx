'use client';
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Excalidraw, CaptureUpdateAction } from '@excalidraw/excalidraw';
import type {
  BinaryFileData, Collaborator, ExcalidrawImperativeAPI, SocketId,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import type { Awareness } from 'y-protocols/awareness';
import {
  elementStore, fileStore, readElements, readFiles, writeElements, writeFiles,
} from './sync';
import type { BoardElement, BoardFile } from './sync';
import { colorFor } from '../editor/collaboration';

const LOCAL_WRITE = 'board-local-write';
const POINTER_INTERVAL_MS = 60;

type Props = {
  doc: Y.Doc;
  awareness: Awareness | null;
  selfClientId: number;
  canEdit: boolean;
  synced: boolean;
};

export default function BoardCanvas({ doc, awareness, selfClientId, canEdit, synced }: Props) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const versions = useRef(new Map<string, number>());
  const rendered = useRef(new Set<string>());
  const fileVersions = useRef(new Map<string, number>());
  const addedFiles = useRef(new Set<string>());
  const lastPointer = useRef(0);
  const [ready, setReady] = useState(false);

  const elements = elementStore(doc);
  const files = fileStore(doc);

  // Seed the canvas declaratively: an imperative updateScene issued during Excalidraw's own
  // mount can be swallowed, which left a synced board rendering an empty scene.
  const initial = useRef<{ elements: BoardElement[]; files: Record<string, BoardFile> } | null>(null);
  if (!initial.current) {
    initial.current = { elements: readElements(elements), files: readFiles(files) };
    for (const element of initial.current.elements) {
      versions.current.set(element.id, element.version);
    }
    for (const id of Object.keys(initial.current.files)) addedFiles.current.add(id);
  }

  const pull = () => {
    const api = apiRef.current;
    if (!api) return;
    const scene = readElements(elements);
    // Seed the version cache first: the onChange this triggers would otherwise write the
    // remote elements straight back into the shared document and loop.
    for (const element of scene) versions.current.set(element.id, element.version);
    api.updateScene({
      // Round-tripped from Excalidraw's own onChange, so these are its objects.
      elements: scene as unknown as readonly ExcalidrawElement[],
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    const missing = Object.entries(readFiles(files))
      .filter(([id]) => !addedFiles.current.has(id))
      .map(([, file]) => file as unknown as BinaryFileData);
    if (missing.length) {
      for (const file of missing) addedFiles.current.add(file.id);
      api.addFiles(missing);
    }
  };

  useEffect(() => {
    if (!ready || !synced) return;
    pull();
    const onRemote = (_event: Y.YMapEvent<string>, transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_WRITE) return;
      pull();
    };
    elements.observe(onRemote);
    files.observe(onRemote);
    return () => {
      elements.unobserve(onRemote);
      files.unobserve(onRemote);
    };
  }, [ready, synced, elements, files]);

  useEffect(() => {
    if (!awareness) return;
    const publishCursors = () => {
      const api = apiRef.current;
      if (!api) return;
      const collaborators = new Map<SocketId, Collaborator>();
      awareness.states.forEach((state, clientId) => {
        if (clientId === selfClientId) return;
        const value = state as {
          user?: { name?: string };
          pointer?: { x: number; y: number };
        };
        if (!value.user?.name || !value.pointer) return;
        const color = colorFor(value.user.name);
        const socketId = String(clientId) as SocketId;
        collaborators.set(socketId, {
          socketId,
          username: value.user.name,
          color: { background: color, stroke: color },
          pointer: { x: value.pointer.x, y: value.pointer.y, tool: 'pointer' },
          button: 'up',
        });
      });
      api.updateScene({ collaborators });
    };
    publishCursors();
    awareness.on('change', publishCursors);
    return () => awareness.off('change', publishCursors);
  }, [awareness, selfClientId]);

  const publishPointer = (x: number, y: number) => {
    if (!awareness) return;
    const now = Date.now();
    if (now - lastPointer.current < POINTER_INTERVAL_MS) return;
    lastPointer.current = now;
    awareness.setLocalStateField('pointer', { x, y });
  };

  const onChange: React.ComponentProps<typeof Excalidraw>['onChange'] = (scene, _appState, fileMap) => {
    if (!canEdit || !ready || !synced) return;
    doc.transact(() => {
      writeElements(elements, scene, versions.current, rendered.current);
      writeFiles(files, fileMap, fileVersions.current);
    }, LOCAL_WRITE);
  };

  return (
    <div className="board-shell">
      <Excalidraw
        excalidrawAPI={api => {
          apiRef.current = api;
          // Pull against *this* instance: a remount can hand us a fresh API without changing
          // any effect dependency, and then nothing would ever feed it the shared state.
          pull();
          setReady(true);
        }}
        onChange={onChange}
        onPointerUpdate={({ pointer }) => publishPointer(pointer.x, pointer.y)}
        viewModeEnabled={!canEdit}
        isCollaborating
        initialData={{
          appState: { theme: 'dark', viewModeEnabled: !canEdit },
          elements: initial.current.elements as unknown as readonly ExcalidrawElement[],
          files: initial.current.files as unknown as Record<string, BinaryFileData>,
        }}
      />
    </div>
  );
}

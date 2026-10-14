import { Suspense, useRef } from 'react';
import { Spinner } from '@librechat/client';
import * as Tabs from '@radix-ui/react-tabs';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react/unstyled';
import type { editor } from 'monaco-editor';
import type { ProcessedMermaidSvg } from '~/utils/diagram/export';
import { MermaidRenderer } from '~/components/Messages/Content/Mermaid/Mermaid';
import { isCsvArtifact, isWaveDromArtifactType } from '~/utils/artifacts';
import { MERMAID_ARTIFACT_TYPE, type Artifact } from '~/common/artifacts';
import { useArtifactCode } from '~/Providers/EditorContext';
import { ArtifactCodeEditor } from './ArtifactCodeEditor';
import CsvTelemetryViewer from './CsvTelemetryViewer';
import { lazyWithRecovery } from '~/lib/assets/lazy';
import WaveDromViewer from './WaveDromViewer';
import { useLocalize } from '~/hooks';

const SandboxArtifactTabs = lazyWithRecovery(() => import('./SandboxArtifactTabs'));

interface ArtifactTabsProps {
  artifact: Artifact;
  previewRef: React.MutableRefObject<SandpackPreviewRef>;
  isSharedConvo?: boolean;
  onMermaidExportReady?: (data: ProcessedMermaidSvg | null) => void;
}

function LoadingArtifactTabs() {
  const localize = useLocalize();

  return (
    <div
      className="bg-surface-primary text-text-secondary flex h-full w-full items-center justify-center"
      role="status"
    >
      <Spinner className="size-5" aria-hidden="true" />
      <span className="sr-only">{localize('com_ui_loading')}</span>
    </div>
  );
}

function MermaidArtifactTabs({
  artifact,
  isSharedConvo,
  onMermaidExportReady,
}: Omit<ArtifactTabsProps, 'previewRef'>) {
  const localize = useLocalize();
  const editedCode = useArtifactCode(artifact.id);
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  /* The buffer belongs to whichever artifact last wrote it: a freshly keyed
   * renderer must not show (or export) the diagram we navigated away from,
   * while a pane that remounted for another host keeps its unsaved text and a
   * displaced copy is just as much this artifact's own. */
  const content = editedCode ?? artifact.content ?? '';
  const isReadOnly = isSharedConvo === true || artifact.index == null;

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full grow overflow-auto"
        tabIndex={-1}
      >
        <ArtifactCodeEditor artifact={artifact} monacoRef={monacoRef} readOnly={isReadOnly} />
      </Tabs.Content>

      <Tabs.Content
        value="preview"
        className="min-h-0 w-full flex-1 overflow-hidden p-4"
        tabIndex={-1}
      >
        {/* Keyed by artifact so switching between two diagrams cannot carry the
            previous render, its dimensions, or its export payload across the
            boundary while the new source debounces. */}
        <MermaidRenderer
          key={artifact.id}
          exportFilename={artifact.title ?? localize('com_ui_mermaid_diagram')}
          fillContainer
          onExportReady={onMermaidExportReady}
          showExpandButton={false}
          showHeader={false}
        >
          {content}
        </MermaidRenderer>
      </Tabs.Content>
    </div>
  );
}

function WaveDromArtifactTabs({
  artifact,
  isSharedConvo,
}: Omit<ArtifactTabsProps, 'previewRef' | 'onMermaidExportReady'>) {
  const editedCode = useArtifactCode(artifact.id);
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const content = editedCode ?? artifact.content ?? '';
  const isReadOnly = isSharedConvo === true || artifact.index == null;

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full grow overflow-auto"
        tabIndex={-1}
      >
        <ArtifactCodeEditor artifact={artifact} monacoRef={monacoRef} readOnly={isReadOnly} />
      </Tabs.Content>

      <Tabs.Content
        value="preview"
        className="min-h-0 w-full flex-1 overflow-hidden p-4"
        tabIndex={-1}
      >
        <WaveDromViewer key={artifact.id} content={content} title={artifact.title} />
      </Tabs.Content>
    </div>
  );
}

function CsvArtifactTabs({
  artifact,
  isSharedConvo,
}: Omit<ArtifactTabsProps, 'previewRef' | 'onMermaidExportReady'>) {
  const editedCode = useArtifactCode(artifact.id);
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const content = editedCode ?? artifact.content ?? '';
  const isReadOnly = isSharedConvo === true || artifact.index == null;

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full grow overflow-auto"
        tabIndex={-1}
      >
        <ArtifactCodeEditor artifact={artifact} monacoRef={monacoRef} readOnly={isReadOnly} />
      </Tabs.Content>

      <Tabs.Content
        value="preview"
        className="min-h-0 w-full flex-1 overflow-hidden p-4"
        tabIndex={-1}
      >
        <CsvTelemetryViewer key={artifact.id} content={content} title={artifact.title} />
      </Tabs.Content>
    </div>
  );
}

export default function ArtifactTabs(props: ArtifactTabsProps) {
  if (props.artifact.type === MERMAID_ARTIFACT_TYPE) {
    return (
      <MermaidArtifactTabs
        artifact={props.artifact}
        isSharedConvo={props.isSharedConvo}
        onMermaidExportReady={props.onMermaidExportReady}
      />
    );
  }

  if (isWaveDromArtifactType(props.artifact.type)) {
    return <WaveDromArtifactTabs artifact={props.artifact} isSharedConvo={props.isSharedConvo} />;
  }

  if (isCsvArtifact(props.artifact)) {
    return <CsvArtifactTabs artifact={props.artifact} isSharedConvo={props.isSharedConvo} />;
  }

  return (
    <Suspense fallback={<LoadingArtifactTabs />}>
      <SandboxArtifactTabs {...props} />
    </Suspense>
  );
}

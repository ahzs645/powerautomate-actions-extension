import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { mergeStyles } from '@fluentui/react/lib/Styling';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlowAnalysisResult, FlowAnalyzer } from '../../services/FlowAnalyzer';
import { FlowDiagramTab } from './FlowDiagramTab';
import { JsonRange } from './flowJsonLocator';

const paneClass = mergeStyles({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-fg)',
});

export interface FlowDiagramViewProps {
  /** Current editor text. Re-analysed after typing pauses. */
  text: string;
  flowName: string;
  mode: 'diagram' | 'split';
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onRevealRange: (range: JsonRange) => void;
}

/** How long typing has to pause before the diagram is redrawn. */
const ANALYZE_DELAY_MS = 400;

/**
 * The diagram as a first-class view next to (or instead of) the JSON editor.
 * While the JSON does not parse, it keeps showing the last version that did.
 */
export const FlowDiagramView: React.FC<FlowDiagramViewProps> = ({
  text,
  flowName,
  mode,
  selectedKey,
  onSelect,
  onRevealRange,
}) => {
  const [debouncedText, setDebouncedText] = useState(text);
  const lastGood = useRef<FlowAnalysisResult | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedText(text), ANALYZE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const analysis = useMemo(() => {
    try {
      const result = new FlowAnalyzer().analyze(JSON.parse(debouncedText), flowName);
      lastGood.current = result;
      return { result, stale: false };
    } catch {
      return { result: lastGood.current, stale: true };
    }
  }, [debouncedText, flowName]);

  return (
    <div className={paneClass}>
      {analysis.stale && (
        <MessageBar messageBarType={MessageBarType.warning}>
          {analysis.result
            ? 'The JSON has a syntax error, so the diagram shows the last version that parsed.'
            : 'The JSON has a syntax error, so there is nothing to draw yet.'}
        </MessageBar>
      )}
      {analysis.result && (
        <div style={{ flex: 1, minHeight: 0 }}>
          <FlowDiagramTab
            layout="fill"
            showDetails={mode === 'diagram'}
            actions={analysis.result.actions}
            trigger={analysis.result.trigger}
            flowDefinition={debouncedText}
            flowName={flowName}
            selectedKey={selectedKey}
            onSelect={onSelect}
            onRevealRange={onRevealRange}
          />
        </div>
      )}
    </div>
  );
};

export default FlowDiagramView;

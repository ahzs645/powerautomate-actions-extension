import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';

export interface StatusMessage {
  key: string;
  type: MessageBarType;
  content: ReactNode;
  multiline?: boolean;
}

/** Confirmations fade on their own; anything the user may need to act on stays. */
const AUTO_DISMISS = new Set<MessageBarType>([MessageBarType.success, MessageBarType.info]);
export const AUTO_DISMISS_MS = 4000;

let counter = 0;

/**
 * One status line for a page (a new message replaces the previous one).
 * Success and info messages dismiss themselves after a few seconds; errors,
 * warnings and blocked states persist until dismissed or replaced.
 */
export const useStatusMessages = (autoDismissMs: number = AUTO_DISMISS_MS) => {
  const [messages, setMessages] = useState<StatusMessage[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
    setMessages((current) => current.filter((m) => m.key !== key));
  }, []);

  const show = useCallback(
    (content: ReactNode, type: MessageBarType = MessageBarType.success, multiline?: boolean) => {
      const key = `msg-${Date.now()}-${++counter}`;
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
      setMessages([{ key, type, content, multiline: multiline ?? typeof content !== 'string' }]);
      if (AUTO_DISMISS.has(type) && autoDismissMs > 0) {
        timers.current.set(
          key,
          window.setTimeout(() => dismiss(key), autoDismissMs)
        );
      }
      return key;
    },
    [autoDismissMs, dismiss]
  );

  const clear = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
    setMessages([]);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return { messages, show, dismiss, clear };
};

export const StatusMessages: React.FC<{
  messages: StatusMessage[];
  onDismiss: (key: string) => void;
}> = ({ messages, onDismiss }) => (
  <>
    {messages.map((msg) => (
      <MessageBar
        key={msg.key}
        messageBarType={msg.type}
        isMultiline={!!msg.multiline}
        onDismiss={() => onDismiss(msg.key)}
        dismissButtonAriaLabel="Dismiss"
      >
        {msg.content}
      </MessageBar>
    ))}
  </>
);

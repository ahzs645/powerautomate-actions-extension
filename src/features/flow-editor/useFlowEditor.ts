import { MessageBarType } from "@fluentui/react/lib/MessageBar";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMessageBar } from "../../components/shared/Messages";
import { useApiProviderContext } from "../../services/ApiProvider";
import { FlowError } from "./types";

const DEBUG = true;

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[PA-Toolkit FlowEditor]', ...args);
  }
}

function debugError(...args: any[]) {
  if (DEBUG) {
    console.error('[PA-Toolkit FlowEditor Error]', ...args);
  }
}

export const useFlowEditor = () => {
  const editorSchema = "https://power-automate-toolkit.local/flow-editor.json#";
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [validationPaneIsOpen, setValidationPaneIsOpen] = useState<boolean>(false);
  const hasFetchedRef = useRef<boolean>(false);

  const [validationResult, setValidationResult] = useState<{
    errors: FlowError[];
    warnings: FlowError[];
  }>({ errors: [], warnings: [] });

  const api = useApiProviderContext();
  const query = new URLSearchParams(window.location.search);

  const envId = query.get("envId");
  const flowId = query.get("flowId");

  const messageBar = useMessageBar();

  const addMessage = useCallback((msg: string | string[], type?: MessageBarType) => {
    debugLog('Adding message:', msg, 'type:', type);
    messageBar.setMessages([
      {
        key: Date.now().toString(),
        messageBarType: type || MessageBarType.success,
        isMultiline: typeof msg !== "string",
        children: msg,
      },
    ]);
  }, [messageBar.setMessages]);

  useEffect(() => {
    if (!envId || !flowId) {
      debugError('Missing required parameters - envId:', envId, 'flowId:', flowId);
      addMessage(
        'Invalid URL parameters. Please open the extension from a Power Automate flow page.',
        MessageBarType.error
      );
    }
  }, [envId, flowId]); // Removed addMessage from deps to prevent loop

  const [data, setData] = useState<{
    name: string;
    definition: string;
    environment: any;
  }>({
    name: "",
    definition: "",
    environment: null,
  });

  useEffect(() => {
    // Prevent duplicate fetches
    if (hasFetchedRef.current) {
      return;
    }

    (async () => {
      if (envId && flowId && api.isApiReady) {
        hasFetchedRef.current = true;

        try {
          debugLog('Fetching flow data...');
          setIsLoading(true);

          const flowUrl = getFlowUrl(envId, flowId);
          debugLog('Flow URL:', flowUrl);

          const flow = await api.get(flowUrl);
          debugLog('Flow data received:', {
            displayName: flow.properties?.displayName,
            hasDefinition: !!flow.properties?.definition,
            hasConnectionReferences: !!flow.properties?.connectionReferences,
            hasEnvironment: !!flow.properties?.environment
          });

          if (!flow.properties) {
            throw new Error('Invalid flow data - missing properties');
          }

          if (!flow.properties.definition) {
            throw new Error('Invalid flow data - missing definition');
          }

          if (!flow.properties.connectionReferences) {
            debugLog('Warning: Flow has no connection references');
          }

          const flowDefinition = {
            $schema: editorSchema,
            connectionReferences: flow.properties.connectionReferences || {},
            definition: flow.properties.definition,
          };

          setData({
            name: flow.properties.displayName || 'Untitled Flow',
            environment: flow.properties.environment,
            definition: JSON.stringify(flowDefinition, null, 2),
          });

          debugLog('Flow data loaded successfully');
          messageBar.setMessages([{
            key: Date.now().toString(),
            messageBarType: MessageBarType.success,
            isMultiline: false,
            children: `Flow "${flow.properties.displayName}" loaded successfully.`,
          }]);

        } catch (error) {
          debugError('Error fetching flow:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          messageBar.setMessages([{
            key: Date.now().toString(),
            messageBarType: MessageBarType.error,
            isMultiline: false,
            children: `Error loading flow: ${errorMessage}`,
          }]);
        } finally {
          setIsLoading(false);
        }
      } else if (envId && flowId && !api.isApiReady) {
        debugLog('Waiting for API to be ready...');
      }
    })();
  }, [envId, flowId, api.isApiReady]); // Removed addMessage and editorSchema to prevent loop

  const saveDefinition = async (
    name: string,
    environment: any,
    definition: string
  ) => {
    if (!envId || !flowId) {
      addMessage('Cannot save - missing flow parameters', MessageBarType.error);
      return null;
    }

    if (!name?.trim()) {
      addMessage('Flow name cannot be empty', MessageBarType.error);
      return null;
    }

    if (!definition?.trim()) {
      addMessage('Flow definition cannot be empty', MessageBarType.error);
      return null;
    }

    let parsedData;
    try {
      parsedData = JSON.parse(definition);
    } catch (error) {
      debugError('JSON parse error:', error);
      addMessage('Invalid JSON format in flow definition', MessageBarType.error);
      return null;
    }

    if (!parsedData.definition) {
      addMessage('Missing "definition" property in flow definition', MessageBarType.error);
      return null;
    }

    if (!parsedData.connectionReferences) {
      debugLog('Warning: No connection references in definition');
      parsedData.connectionReferences = {};
    }

    let retVal: string | null = null;

    try {
      debugLog('Saving flow definition...');
      setIsLoading(true);

      const savePayload = {
        properties: {
          displayName: name.trim(),
          environment: environment,
          definition: parsedData.definition,
          connectionReferences: parsedData.connectionReferences,
        },
      };

      debugLog('Save payload:', {
        displayName: savePayload.properties.displayName,
        hasDefinition: !!savePayload.properties.definition,
        hasConnectionReferences: !!savePayload.properties.connectionReferences,
        hasEnvironment: !!savePayload.properties.environment
      });

      const response = await api.patch(getFlowUrl(envId, flowId), savePayload);

      debugLog('Save response received');

      if (!response?.properties) {
        throw new Error('Invalid save response - missing properties');
      }

      retVal = JSON.stringify(
        {
          $schema: editorSchema,
          connectionReferences: response.properties.connectionReferences || {},
          definition: response.properties.definition,
        },
        null,
        2
      );

      debugLog('Flow saved successfully');
      addMessage(`Flow "${name}" saved successfully.`);

    } catch (error) {
      debugError('Error saving flow:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      addMessage(
        `Error saving flow: ${errorMessage}`,
        MessageBarType.error
      );
    } finally {
      setIsLoading(false);
    }

    return retVal;
  };

  const validate = async (definition: string) => {
    if (!envId || !flowId) {
      addMessage('Cannot validate - missing flow parameters', MessageBarType.error);
      return;
    }

    if (!definition?.trim()) {
      addMessage('Cannot validate empty definition', MessageBarType.error);
      return;
    }

    let parsedData;
    try {
      parsedData = JSON.parse(definition);
    } catch (error) {
      debugError('JSON parse error during validation:', error);
      addMessage('Invalid JSON format - cannot validate', MessageBarType.error);
      return;
    }

    if (!parsedData.definition) {
      addMessage('Missing "definition" property - cannot validate', MessageBarType.error);
      return;
    }

    try {
      debugLog('Validating flow definition...');
      setIsLoading(true);

      const validationPayload = {
        properties: {
          definition: parsedData.definition,
        },
      };

      debugLog('Validation payload prepared');

      const [errors, warnings] = await Promise.all([
        api.post(`${getFlowUrl(envId, flowId)}/checkFlowErrors`, validationPayload)
          .catch(error => {
            debugError('Error check failed:', error);
            return [];
          }),
        api.post(`${getFlowUrl(envId, flowId)}/checkFlowWarnings`, validationPayload)
          .catch(error => {
            debugError('Warning check failed:', error);
            return [];
          })
      ]);

      debugLog('Validation completed - errors:', errors.length, 'warnings:', warnings.length);

      setValidationResult({
        errors: Array.isArray(errors) ? errors : [],
        warnings: Array.isArray(warnings) ? warnings : []
      });
      setValidationPaneIsOpen(true);

      const totalIssues = (errors?.length || 0) + (warnings?.length || 0);
      if (totalIssues === 0) {
        addMessage('Validation completed - no issues found.');
      } else {
        addMessage(
          `Validation completed - found ${errors?.length || 0} errors and ${warnings?.length || 0} warnings.`,
          MessageBarType.warning
        );
      }

    } catch (error) {
      debugError('Error during validation:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      addMessage(
        `Error during validation: ${errorMessage}`,
        MessageBarType.error
      );
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    validationPaneIsOpen,
    setValidationPaneIsOpen,
    validationResult,
    ...messageBar,
    ...data,
    saveDefinition,
    validate,
  };
};

function getFlowUrl(envId: string | null, flowId: string | null) {
  if (!envId || !flowId) {
    throw new Error('Missing environment ID or flow ID');
  }
  return `providers/Microsoft.ProcessSimple/environments/${envId}/flows/${flowId}`;
}

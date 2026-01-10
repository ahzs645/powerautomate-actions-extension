import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { FlowEditorActions } from './interfaces/IFlowEditorActions';

export interface IApiProvider {
  get(url: string): Promise<any>;
  patch(url: string, data: any): Promise<any>;
  post(url: string, data: any): Promise<any>;
  isApiReady: boolean;
}

interface IApiDetails {
  apiUrl?: string;
  token?: string;
  isReady: boolean;
}

const DEBUG = true;

function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log('[PA-Toolkit API]', ...args);
  }
}

function debugError(...args: any[]) {
  if (DEBUG) {
    console.error('[PA-Toolkit API Error]', ...args);
  }
}

export const ApiProviderContext = createContext<IApiProvider>({} as any);

export const ApiProviderContextRoot = (): IApiProvider => {
  const [apiDetails, setApiDetails] = useState<IApiDetails>({ isReady: false });

  const http = useMemo(
    () => async (url: string, method: string, data?: any, retryCount = 0): Promise<any> => {
      const maxRetries = 3;
      const retryDelay = 1000;

      if (!apiDetails.apiUrl || !apiDetails.token) {
        throw new Error('API not ready - missing URL or token');
      }

      const endpointUrl = apiDetails.apiUrl + url;
      const fullUrl = endpointUrl +
        (endpointUrl.includes('?')
          ? '&api-version=2016-11-01'
          : '?api-version=2016-11-01');

      debugLog(`${method} request to:`, fullUrl);
      if (data) {
        debugLog('Request data:', data);
      }

      try {
        const response = await fetch(fullUrl, {
          method: method,
          body: data ? JSON.stringify(data) : undefined,
          headers: {
            authorization: apiDetails.token,
            'Content-Type': 'application/json',
          } as any,
        });

        debugLog(`Response status: ${response.status} ${response.statusText}`);

        let body;
        const contentType = response.headers.get('content-type');

        if (contentType && contentType.includes('application/json')) {
          body = await response.json();
        } else {
          const text = await response.text();
          body = text ? { message: text } : {};
        }

        if (response.ok) {
          debugLog('Request successful');
          return body;
        }

        if (response.status === 401) {
          debugError('Authentication failed - token may be expired');
          throw new Error('Authentication failed. Please refresh the Power Automate page and try again.');
        }

        if (response.status === 403) {
          debugError('Access forbidden - insufficient permissions');
          throw new Error('Access forbidden. You may not have permission to modify this flow.');
        }

        if (response.status === 404) {
          debugError('Resource not found');
          throw new Error('Flow not found. It may have been deleted or moved.');
        }

        if (response.status === 429) {
          debugError('Rate limited');
          if (retryCount < maxRetries) {
            debugLog(`Rate limited, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
            return http(url, method, data, retryCount + 1);
          }
          throw new Error('Too many requests. Please wait a moment and try again.');
        }

        if (response.status >= 500) {
          debugError('Server error:', response.status);
          if (retryCount < maxRetries) {
            debugLog(`Server error, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
            return http(url, method, data, retryCount + 1);
          }
          throw new Error('Server error. Please try again later.');
        }

        const errorMessage = body?.error?.message || body?.message || `HTTP ${response.status}: ${response.statusText}`;
        debugError('API error:', errorMessage);
        throw new Error(errorMessage);

      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('Authentication failed') ||
              error.message.includes('Access forbidden') ||
              error.message.includes('Flow not found') ||
              error.message.includes('Too many requests') ||
              error.message.includes('Server error')) {
            throw error;
          }
        }

        if (error instanceof TypeError && error.message.includes('fetch')) {
          debugError('Network error:', error);
          if (retryCount < maxRetries) {
            debugLog(`Network error, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
            return http(url, method, data, retryCount + 1);
          }
          throw new Error('Network error. Please check your connection and try again.');
        }

        debugError('Unexpected error:', error);
        throw new Error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [apiDetails.apiUrl, apiDetails.token]
  );

  useEffect(() => {
    const cb = (action: FlowEditorActions, sender: any, sendResponse: () => void) => {
      debugLog('Received action:', action.type);

      switch (action.type) {
        case 'token-changed':
          debugLog('Token updated, API ready:', Boolean(action.apiUrl && action.token));
          setApiDetails({
            apiUrl: action.apiUrl,
            token: action.token,
            isReady: Boolean(action.apiUrl && action.token),
          });
          break;
        default:
          break;
      }
      sendResponse();
    };

    chrome.runtime.onMessage.addListener(cb);

    debugLog('Sending app-loaded message');
    chrome.runtime.sendMessage({ type: 'app-loaded' } as FlowEditorActions, (response) => {
      if (chrome.runtime.lastError) {
        debugError('Failed to send app-loaded message:', chrome.runtime.lastError);
      } else {
        debugLog('App-loaded message sent successfully');
      }
    });

    return () => {
      chrome.runtime.onMessage.removeListener(cb);
    };
  }, []);

  return {
    get: (url: string) => http(url, 'GET'),
    patch: (url: string, data: any) => http(url, 'PATCH', data),
    post: (url: string, data: any) => http(url, 'POST', data),
    isApiReady: apiDetails.isReady,
  };
};

export const useApiProviderContext = () => useContext(ApiProviderContext);

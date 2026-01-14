// useRecording - Custom hook for recording functionality
// Extracted from App.tsx

import { useState, useCallback, useRef, useEffect } from 'react';
import { ActionType, IDataChromeMessage, AppElement } from '../models';
import { ISettingsModel } from '../models/ISettingsModel';
import { StorageService } from '../services/StorageService';
import { ExtensionCommunicationService } from '../services';

export interface UseRecordingResult {
  isRecording: boolean;
  recordingTimeLeft: number | null;
  formattedTimeLeft: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  resumeRecordingTimer: (settings: ISettingsModel) => void;
}

export function useRecording(
  storageService: StorageService,
  communicationService: ExtensionCommunicationService,
  onNotification?: (message: string, isSuccess: boolean) => void
): UseRecordingResult {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingTimeLeft, setRecordingTimeLeft] = useState<number | null>(null);

  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Format time left as MM:SS
  const formattedTimeLeft = recordingTimeLeft !== null
    ? `${Math.floor(recordingTimeLeft / 60)}:${(recordingTimeLeft % 60).toString().padStart(2, '0')}`
    : null;

  // Stop recording timer
  const stopRecordingTimer = useCallback(async () => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setRecordingTimeLeft(null);
    await storageService.setRecordingStartTime(null);
  }, [storageService]);

  // Start recording timer
  const startRecordingTimer = useCallback(async (
    maxRecordingTimeMinutes: number,
    startTime?: number
  ) => {
    const currentStartTime = startTime || Date.now();
    const maxTimeMs = maxRecordingTimeMinutes * 60 * 1000;

    if (startTime) {
      // Resuming existing recording
      const elapsedMs = Date.now() - startTime;
      const remainingMs = maxTimeMs - elapsedMs;
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      setRecordingTimeLeft(remainingSeconds);

      recordingTimerRef.current = setTimeout(() => {
        const message: IDataChromeMessage = {
          actionType: ActionType.StopRecording,
          message: 'Stop recording - time limit reached',
        };
        communicationService.sendRequest(
          message,
          AppElement.ReactApp,
          AppElement.Background,
          (response) => {
            setIsRecording(response);
            onNotification?.(`Recording stopped automatically after ${maxRecordingTimeMinutes} minutes`, false);
            stopRecordingTimer();
          }
        );
      }, remainingMs);
    } else {
      // Starting new recording
      setRecordingTimeLeft(maxRecordingTimeMinutes * 60);

      recordingTimerRef.current = setTimeout(() => {
        const message: IDataChromeMessage = {
          actionType: ActionType.StopRecording,
          message: 'Stop recording - time limit reached',
        };
        communicationService.sendRequest(
          message,
          AppElement.ReactApp,
          AppElement.Background,
          (response) => {
            setIsRecording(response);
            onNotification?.(`Recording stopped automatically after ${maxRecordingTimeMinutes} minutes`, false);
            stopRecordingTimer();
          }
        );
      }, maxTimeMs);

      await storageService.setRecordingStartTime(currentStartTime);
    }

    // Start countdown interval
    countdownTimerRef.current = setInterval(() => {
      setRecordingTimeLeft((prevTime) => {
        if (prevTime === null || prevTime <= 1) {
          return null;
        }
        return prevTime - 1;
      });
    }, 1000);
  }, [communicationService, stopRecordingTimer, storageService, onNotification]);

  // Start recording
  const startRecording = useCallback(async () => {
    const settings = await storageService.getSettings();
    const message: IDataChromeMessage = {
      actionType: ActionType.StartRecording,
      message: 'Start recording',
    };

    communicationService.sendRequest(
      message,
      AppElement.ReactApp,
      AppElement.Background,
      (response) => {
        setIsRecording(response);
        if (response && settings.maximumRecordingTimeMinutes && settings.maximumRecordingTimeMinutes > 0) {
          startRecordingTimer(settings.maximumRecordingTimeMinutes);
        }
      }
    );
  }, [communicationService, storageService, startRecordingTimer]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    const message: IDataChromeMessage = {
      actionType: ActionType.StopRecording,
      message: 'Stop recording',
    };

    communicationService.sendRequest(
      message,
      AppElement.ReactApp,
      AppElement.Background,
      async (response) => {
        setIsRecording(response);
        await stopRecordingTimer();
      }
    );
  }, [communicationService, stopRecordingTimer]);

  // Toggle recording
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Resume recording timer if there's an active recording
  const resumeRecordingTimer = useCallback((settings: ISettingsModel) => {
    storageService.getIsRecordingValue().then((recording) => {
      setIsRecording(recording);

      if (recording && settings.recordingStartTime && settings.maximumRecordingTimeMinutes) {
        const elapsedMs = Date.now() - settings.recordingStartTime;
        const maxTimeMs = settings.maximumRecordingTimeMinutes * 60 * 1000;
        const remainingMs = maxTimeMs - elapsedMs;

        if (remainingMs > 0) {
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          setRecordingTimeLeft(remainingSeconds);
          startRecordingTimer(settings.maximumRecordingTimeMinutes, settings.recordingStartTime);
        } else {
          // Time limit already exceeded
          const message: IDataChromeMessage = {
            actionType: ActionType.StopRecording,
            message: 'Stop recording - time limit already reached',
          };
          communicationService.sendRequest(
            message,
            AppElement.ReactApp,
            AppElement.Background,
            (response) => {
              setIsRecording(response);
              onNotification?.('Recording was stopped automatically - time limit exceeded', false);
              stopRecordingTimer();
            }
          );
        }
      }
    });
  }, [storageService, communicationService, startRecordingTimer, stopRecordingTimer, onNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecordingTimer();
    };
  }, [stopRecordingTimer]);

  return {
    isRecording,
    recordingTimeLeft,
    formattedTimeLeft,
    startRecording,
    stopRecording,
    toggleRecording,
    resumeRecordingTimer,
  };
}

export default useRecording;

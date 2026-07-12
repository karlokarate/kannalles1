/** Starts the browser API without allowing a synchronous permission/state error to escape React. */
export function startSpeechRecognitionSafely(
  recognition: Pick<SpeechRecognition, 'start'>,
  onListeningChange: (listening: boolean) => void,
  onStartError: (error: unknown) => void
): boolean {
  onListeningChange(true);
  try {
    recognition.start();
    return true;
  } catch (error) {
    onListeningChange(false);
    onStartError(error);
    return false;
  }
}

interface AppleMobileNavigator {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

export function isAppleMobileSpeechClient(client: AppleMobileNavigator): boolean {
  return /iPhone|iPad|iPod/i.test(client.userAgent)
    || (client.platform === 'MacIntel' && (client.maxTouchPoints ?? 0) > 1);
}

export function unavailableSpeechMessage(appleMobile: boolean): string {
  return appleMobile
    ? 'Auf dem iPhone benötigt Spracheingabe aktivierte Siri und Diktierfunktion. Aktiviere beides in den iOS-Einstellungen oder nutze jetzt das Mikrofon der geöffneten Tastatur.'
    : 'Sprachsuche wird von diesem Browser nicht unterstützt. Die Texteingabe bleibt verfügbar.';
}

export function speechRecognitionErrorMessage(error: string, appleMobile: boolean): string {
  switch (error) {
    case 'not-allowed':
      return appleMobile
        ? 'Mikrofonzugriff ist blockiert. In Safari: „aA“ → Website-Einstellungen → Mikrofon → Erlauben. Danach erneut auf „Sprechen“ tippen.'
        : 'Mikrofonzugriff ist blockiert. Bitte erlaube ihn in den Website-Einstellungen und versuche es erneut.';
    case 'service-not-allowed':
      return appleMobile
        ? 'Die iPhone-Spracherkennung ist deaktiviert. Bitte Siri und die Diktierfunktion in den iOS-Einstellungen aktivieren; alternativ das Tastatur-Mikrofon verwenden.'
        : 'Der Spracherkennungsdienst ist im Browser deaktiviert.';
    case 'audio-capture':
      return 'Kein Mikrofon verfügbar. Bitte prüfe die Mikrofonfreigabe und ob ein anderes Programm das Mikrofon verwendet.';
    case 'no-speech':
      return 'Es wurde keine Sprache erkannt. Bitte erneut tippen und nach dem Mikrofonsignal sprechen.';
    case 'network':
      return 'Die Spracherkennung konnte nicht verbunden werden. Bitte die Internetverbindung prüfen und erneut versuchen.';
    case 'aborted':
      return 'Spracheingabe beendet.';
    default:
      return appleMobile
        ? 'Die iPhone-Spracherkennung konnte nicht gestartet werden. Bitte Siri, Diktierfunktion und die Safari-Mikrofonfreigabe prüfen.'
        : 'Spracheingabe fehlgeschlagen. Du kannst sofort erneut starten oder Text eingeben.';
  }
}

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

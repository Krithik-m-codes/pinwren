// de translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "Bildschirm aufnehmen",
  recTitle: "Bildschirm aufnehmen",
  recIntro:
    "Zeigen Sie das Problem, während es auftritt. Die Aufnahme erfasst diesen Browser-Tab, daher ist alles enthalten, was darin sichtbar ist.",
  recPoint1: "Es wird nichts hochgeladen, bevor Sie den Bericht senden.",
  recPoint2: "Auf der Seite als privat markierte Felder werden in einer Aufnahme nicht verborgen.",
  recLimit: "Maximale Länge: {time}. Die Aufnahme endet automatisch.",
  recMic: "Sprachkommentar hinzufügen",
  recMicNote: "Ihr Browser fragt nach der Erlaubnis, das Mikrofon zu verwenden.",
  recStart: "Aufnahme starten",
  recCountdown: "Die Aufnahme beginnt in {n}",
  recHidden:
    "Bewegen Sie den Zeiger in die untere linke Ecke oder drücken Sie Alt+Umschalt+S zum Beenden. Die Bedienelemente werden nicht aufgenommen.",
  recBar: "Steuerung der Bildschirmaufnahme",
  recRecording: "Aufnahme läuft",
  recPaused: "Pausiert",
  recPause: "Aufnahme pausieren",
  recResume: "Aufnahme fortsetzen",
  recStop: "Aufnahme beenden",
  recTime: "{time} von {max}",
  recWindow: "Aufnahme",
  recPreviewTitle: "Aufnahme prüfen",
  recPreviewLabel: "Vorschau Ihrer Aufnahme",
  recRetake: "Erneut aufnehmen",
  recDiscard: "Verwerfen",
  recAttach: "Aufnahme anhängen",
  recAttached: "Aufnahme angehängt",
  recRemove: "Aufnahme entfernen",
  recRow: "Bildschirmaufnahme · {time}",
  recRowVoice: "Bildschirmaufnahme mit Stimme · {time}",
  recPlay: "Aufnahme abspielen",
  recLimitTime: "Die Aufnahme hat die maximale Länge ({time}) erreicht und wurde beendet.",
  recLimitSize: "Die Aufnahme hat das Größenlimit erreicht und wurde beendet.",
  recMicOff: "Das Mikrofon ist nicht verfügbar, daher hat diese Aufnahme keinen Ton.",
  recDenied:
    "Die Bildschirmaufnahme wurde abgebrochen oder blockiert. Erlauben Sie sie in Ihrem Browser und versuchen Sie es erneut.",
  recUnsupported:
    "Dieser Browser kann den Bildschirm nicht aufnehmen. Probieren Sie die Desktop-Version von Chrome, Edge, Firefox oder Safari.",
  recFailed: "Die Aufnahme ist fehlgeschlagen. Versuchen Sie es erneut.",
  recTooBig: "Diese Aufnahme ist zu groß zum Anhängen. Nehmen Sie eine kürzere auf.",
} satisfies RecordCatalog;

// es translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "Grabar pantalla",
  recTitle: "Graba tu pantalla",
  recIntro:
    "Muestra el problema mientras ocurre. La grabación captura esta pestaña del navegador, así que se incluye todo lo que se vea en ella.",
  recPoint1: "No se sube nada hasta que envíes el informe.",
  recPoint2: "Los campos marcados como privados en la página no se ocultan en una grabación.",
  recLimit: "Duración máxima: {time}. La grabación se detiene sola.",
  recMic: "Añadir narración de voz",
  recMicNote: "Tu navegador te pedirá permiso para usar el micrófono.",
  recStart: "Iniciar grabación",
  recCountdown: "La grabación empieza en {n}",
  recHidden:
    "Mueve el puntero a la esquina inferior izquierda o pulsa Alt+Mayús+S para detener. Los controles no se graban.",
  recBar: "Controles de la grabación de pantalla",
  recRecording: "Grabando",
  recPaused: "En pausa",
  recPause: "Pausar grabación",
  recResume: "Reanudar grabación",
  recStop: "Detener grabación",
  recTime: "{time} de {max}",
  recWindow: "Grabando",
  recPreviewTitle: "Revisa tu grabación",
  recPreviewLabel: "Vista previa de tu grabación",
  recRetake: "Grabar de nuevo",
  recDiscard: "Descartar",
  recAttach: "Adjuntar grabación",
  recAttached: "Grabación adjuntada",
  recRemove: "Quitar grabación",
  recRow: "Grabación de pantalla · {time}",
  recRowVoice: "Grabación de pantalla con voz · {time}",
  recPlay: "Reproducir grabación",
  recLimitTime: "La grabación alcanzó la duración máxima ({time}) y se detuvo.",
  recLimitSize: "La grabación alcanzó el límite de tamaño y se detuvo.",
  recMicOff: "El micrófono no está disponible, así que esta grabación no tiene sonido.",
  recDenied:
    "La grabación de pantalla se canceló o se bloqueó. Permítela en tu navegador e inténtalo de nuevo.",
  recUnsupported:
    "Este navegador no puede grabar la pantalla. Prueba la versión de escritorio de Chrome, Edge, Firefox o Safari.",
  recFailed: "La grabación falló. Inténtalo de nuevo.",
  recTooBig: "La grabación es demasiado grande para adjuntarla. Graba una más corta.",
} satisfies RecordCatalog;
